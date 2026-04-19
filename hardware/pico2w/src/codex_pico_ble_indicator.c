#include <stdbool.h>
#include <inttypes.h>
#include <stdint.h>
#include <stdio.h>
#include <stdarg.h>
#include <string.h>

#include "pico/cyw43_arch.h"
#include "pico/stdlib.h"
#include "pico/stdio_usb.h"

#include "btstack.h"
#include "ble/le_device_db.h"
#include "hardware/sync.h"
#include "hardware/structs/ioqspi.h"
#include "hardware/structs/sio.h"

#include "codex_pico_ble_indicator.h"

#define DEVICE_NAME "codex-pico-ble"
#define ADVERTISING_RECOVER_MS 3000
#define STATE_TIMEOUT_MS 6000
#define WAITING_FLASH_MS 15000
#define DISCONNECTED_FLASH_MS 1200
#define CONNECTING_FLASH_MS 180
#define BOOTSEL_DEBOUNCE_MS 40
#define BOOTSEL_LONG_PRESS_MS 1800

typedef enum {
    INDICATOR_STATE_OFF = 0,
    INDICATOR_STATE_OUTPUTTING = 1,
    INDICATOR_STATE_WAITING = 2,
} indicator_state_t;

static btstack_packet_callback_registration_t hci_event_callback_registration;
static btstack_packet_callback_registration_t sm_event_callback_registration;
static hci_con_handle_t ble_con_handle = HCI_CON_HANDLE_INVALID;
static bool ble_connected = false;
static bool ble_advertising = false;
static bool cyw43_ready = false;
static bool led_level = false;
static bool ble_pairing = false;
static bool ble_bonded = false;
static indicator_state_t requested_state = INDICATOR_STATE_OFF;
static bool requested_state_valid = false;
static absolute_time_t last_state_write_at;
static absolute_time_t state_entered_at;
static bool bootsel_pressed = false;
static absolute_time_t bootsel_pressed_at;
static absolute_time_t bootsel_debounce_until;
static bool bootsel_long_press_fired = false;

static const uint8_t adv_data[] = {
    0x02, BLUETOOTH_DATA_TYPE_FLAGS, 0x06,
    0x0f, BLUETOOTH_DATA_TYPE_COMPLETE_LOCAL_NAME,
    'c', 'o', 'd', 'e', 'x', '-', 'p', 'i', 'c', 'o', '-', 'b', 'l', 'e',
};

static void log_printf(const char *fmt, ...) {
    if (!stdio_usb_connected()) {
        return;
    }
    va_list args;
    va_start(args, fmt);
    vprintf(fmt, args);
    va_end(args);
}

static void log_connection_params(
    const char *label,
    hci_con_handle_t con_handle,
    uint16_t conn_interval,
    uint16_t conn_latency,
    uint16_t supervision_timeout
) {
    log_printf(
        "%s handle=0x%04x interval=%u.%02u ms latency=%u supervision=%u ms\n",
        label,
        con_handle,
        conn_interval * 125 / 100,
        25 * (conn_interval & 3),
        conn_latency,
        supervision_timeout * 10
    );
}

static indicator_state_t clamp_indicator_state(uint8_t raw) {
    switch (raw) {
        case INDICATOR_STATE_OUTPUTTING:
            return INDICATOR_STATE_OUTPUTTING;
        case INDICATOR_STATE_WAITING:
            return INDICATOR_STATE_WAITING;
        case INDICATOR_STATE_OFF:
        default:
            return INDICATOR_STATE_OFF;
    }
}

static bool state_is_stale(void) {
    if (!requested_state_valid) {
        return true;
    }
    return absolute_time_diff_us(last_state_write_at, get_absolute_time()) > ((int64_t)STATE_TIMEOUT_MS * 1000);
}

static indicator_state_t effective_state(void) {
    if (!ble_connected || state_is_stale()) {
        return INDICATOR_STATE_OFF;
    }
    return requested_state;
}

static uint32_t state_elapsed_ms(absolute_time_t now) {
    if (!requested_state_valid) {
        return 0;
    }
    int64_t diff_us = absolute_time_diff_us(state_entered_at, now);
    if (diff_us <= 0) {
        return 0;
    }
    return (uint32_t)(diff_us / 1000);
}

static bool indicator_pattern_level(indicator_state_t state, uint32_t uptime_ms, uint32_t current_state_elapsed_ms) {
    switch (state) {
        case INDICATOR_STATE_OUTPUTTING: {
            UNUSED(current_state_elapsed_ms);
            const uint32_t phase = uptime_ms % 1600;
            return (phase < 210) || (phase >= 340 && phase < 550);
        }
        case INDICATOR_STATE_WAITING: {
            if (current_state_elapsed_ms >= WAITING_FLASH_MS) {
                return true;
            }
            const uint32_t phase = uptime_ms % 200;
            return phase < 90;
        }
        case INDICATOR_STATE_OFF:
        default:
            return false;
    }
}

static bool connection_pattern_level(uint32_t uptime_ms) {
    if (ble_pairing) {
        return (uptime_ms % CONNECTING_FLASH_MS) < (CONNECTING_FLASH_MS / 2);
    }
    return (uptime_ms % DISCONNECTED_FLASH_MS) < 160;
}

static void update_status_led(void) {
    if (!cyw43_ready) {
        return;
    }

    absolute_time_t now = get_absolute_time();
    uint32_t uptime_ms = (uint32_t)to_ms_since_boot(now);
    bool next_level;
    if (!ble_connected) {
        next_level = connection_pattern_level(uptime_ms);
    } else {
        indicator_state_t state = effective_state();
        next_level = indicator_pattern_level(
            state,
            uptime_ms,
            state_elapsed_ms(now)
        );
    }
    if (next_level == led_level) {
        return;
    }

    led_level = next_level;
    cyw43_arch_gpio_put(CYW43_WL_GPIO_LED_PIN, next_level ? 1 : 0);
}

static void reset_runtime_state(void) {
    ble_connected = false;
    ble_con_handle = HCI_CON_HANDLE_INVALID;
    ble_pairing = false;
    requested_state = INDICATOR_STATE_OFF;
    requested_state_valid = false;
    state_entered_at = get_absolute_time();
}

static void ensure_ble_advertising(void) {
    if (ble_connected || ble_advertising) {
        return;
    }
    gap_advertisements_enable(1);
    ble_advertising = true;
    log_printf("BLE advertising restarted\n");
}

static void restart_ble_advertising(const char *reason) {
    if (ble_con_handle != HCI_CON_HANDLE_INVALID) {
        uint8_t status = gap_disconnect(ble_con_handle);
        log_printf(
            "BLE disconnect requested for recovery (%s): status=%u handle=0x%04x\n",
            reason,
            (unsigned)status,
            ble_con_handle
        );
        ble_pairing = false;
        return;
    }
    gap_advertisements_enable(0);
    ble_advertising = false;
    reset_runtime_state();
    gap_advertisements_enable(1);
    ble_advertising = true;
    log_printf("BLE advertising forced restart (%s)\n", reason);
}

static void clear_all_ble_bonds(void) {
    int removed = 0;
    for (int index = 0; index < le_device_db_max_count(); ++index) {
        int addr_type = 0;
        bd_addr_t addr;
        memset(addr, 0, sizeof(addr));
        le_device_db_info(index, &addr_type, addr, NULL);
        bool has_address = false;
        for (size_t i = 0; i < sizeof(addr); ++i) {
            if (addr[i] != 0) {
                has_address = true;
                break;
            }
        }
        if (!has_address) {
            continue;
        }
        gap_delete_bonding((bd_addr_type_t)addr_type, addr);
        removed++;
    }
    ble_bonded = false;
    log_printf("BLE bonds cleared: removed=%d\n", removed);
}

static bool __no_inline_not_in_flash_func(read_bootsel_button_raw)(void) {
    const uint CS_PIN_INDEX = 1;
    uint32_t flags = save_and_disable_interrupts();

    hw_write_masked(
        &ioqspi_hw->io[CS_PIN_INDEX].ctrl,
        GPIO_OVERRIDE_LOW << IO_QSPI_GPIO_QSPI_SS_CTRL_OEOVER_LSB,
        IO_QSPI_GPIO_QSPI_SS_CTRL_OEOVER_BITS
    );

    for (volatile int i = 0; i < 1000; ++i) {
    }

#ifdef __ARM_ARCH_6M__
#define BOOTSEL_CS_BIT (1u << 1)
#else
#define BOOTSEL_CS_BIT SIO_GPIO_HI_IN_QSPI_CSN_BITS
#endif
    bool high_level = (sio_hw->gpio_hi_in & BOOTSEL_CS_BIT) != 0;

    hw_write_masked(
        &ioqspi_hw->io[CS_PIN_INDEX].ctrl,
        GPIO_OVERRIDE_NORMAL << IO_QSPI_GPIO_QSPI_SS_CTRL_OEOVER_LSB,
        IO_QSPI_GPIO_QSPI_SS_CTRL_OEOVER_BITS
    );

    restore_interrupts(flags);
    return !high_level;
}

static void poll_bootsel_recovery_button(void) {
    absolute_time_t now = get_absolute_time();
    if (absolute_time_diff_us(now, bootsel_debounce_until) > 0) {
        return;
    }

    bool pressed_now = read_bootsel_button_raw();
    if (pressed_now && !bootsel_pressed) {
        bootsel_pressed = true;
        bootsel_pressed_at = now;
        bootsel_long_press_fired = false;
        bootsel_debounce_until = delayed_by_ms(now, BOOTSEL_DEBOUNCE_MS);
        log_printf("BOOTSEL pressed\n");
        return;
    }

    if (pressed_now && bootsel_pressed && !bootsel_long_press_fired) {
        int64_t held_us = absolute_time_diff_us(bootsel_pressed_at, now);
        if (held_us >= ((int64_t)BOOTSEL_LONG_PRESS_MS * 1000)) {
            bootsel_long_press_fired = true;
            clear_all_ble_bonds();
            restart_ble_advertising("bootsel long press");
            bootsel_debounce_until = delayed_by_ms(now, BOOTSEL_DEBOUNCE_MS);
        }
        return;
    }

    if (!pressed_now && bootsel_pressed) {
        bootsel_pressed = false;
        bootsel_debounce_until = delayed_by_ms(now, BOOTSEL_DEBOUNCE_MS);
        if (!bootsel_long_press_fired) {
            restart_ble_advertising("bootsel press");
        }
        log_printf("BOOTSEL released\n");
    }
}

static uint16_t att_read_callback(hci_con_handle_t connection_handle, uint16_t att_handle, uint16_t offset, uint8_t *buffer, uint16_t buffer_size) {
    UNUSED(connection_handle);

    if (att_handle == ATT_CHARACTERISTIC_0000CD11_0000_1000_8000_00805F9B34FB_01_VALUE_HANDLE) {
        const uint8_t state_value = (uint8_t)effective_state();
        return att_read_callback_handle_blob(&state_value, sizeof(state_value), offset, buffer, buffer_size);
    }
    return 0;
}

static int att_write_callback(hci_con_handle_t connection_handle, uint16_t att_handle, uint16_t transaction_mode, uint16_t offset, uint8_t *buffer, uint16_t buffer_size) {
    UNUSED(connection_handle);

    if (att_handle != ATT_CHARACTERISTIC_0000CD11_0000_1000_8000_00805F9B34FB_01_VALUE_HANDLE) {
        return 0;
    }
    if (transaction_mode != ATT_TRANSACTION_MODE_NONE || offset != 0 || buffer_size < 1) {
        return 0;
    }

    absolute_time_t now = get_absolute_time();
    indicator_state_t next_state = clamp_indicator_state(buffer[0]);
    if (!requested_state_valid || requested_state != next_state) {
        state_entered_at = now;
        log_printf("BLE state changed: %u\n", (unsigned)next_state);
    }
    requested_state = next_state;
    requested_state_valid = true;
    last_state_write_at = now;
    return 0;
}

static void packet_handler(uint8_t packet_type, uint16_t channel, uint8_t *packet, uint16_t size) {
    UNUSED(channel);
    UNUSED(size);

    if (packet_type != HCI_EVENT_PACKET) {
        return;
    }

    switch (hci_event_packet_get_type(packet)) {
        case HCI_EVENT_DISCONNECTION_COMPLETE:
            log_printf(
                "BLE disconnected: handle=0x%04x reason=0x%02x\n",
                hci_event_disconnection_complete_get_connection_handle(packet),
                hci_event_disconnection_complete_get_reason(packet)
            );
            reset_runtime_state();
            ensure_ble_advertising();
            break;

        case HCI_EVENT_META_GAP:
            switch (hci_event_gap_meta_get_subevent_code(packet)) {
                case GAP_SUBEVENT_LE_CONNECTION_COMPLETE:
                    if (gap_subevent_le_connection_complete_get_status(packet) == ERROR_CODE_SUCCESS) {
                        ble_con_handle = gap_subevent_le_connection_complete_get_connection_handle(packet);
                        ble_connected = true;
                        ble_advertising = false;
                        requested_state = INDICATOR_STATE_OFF;
                        requested_state_valid = false;
                        state_entered_at = get_absolute_time();
                        log_connection_params(
                            "BLE connected",
                            ble_con_handle,
                            gap_subevent_le_connection_complete_get_conn_interval(packet),
                            gap_subevent_le_connection_complete_get_conn_latency(packet),
                            gap_subevent_le_connection_complete_get_supervision_timeout(packet)
                        );
                    }
                    break;
                default:
                    break;
            }
            break;

        case SM_EVENT_JUST_WORKS_REQUEST:
            log_printf("BLE pairing: Just Works requested\n");
            sm_just_works_confirm(sm_event_just_works_request_get_handle(packet));
            break;

        case SM_EVENT_NUMERIC_COMPARISON_REQUEST:
            log_printf("BLE pairing: numeric comparison confirmed\n");
            sm_numeric_comparison_confirm(sm_event_numeric_comparison_request_get_handle(packet));
            break;

        case SM_EVENT_PASSKEY_DISPLAY_NUMBER:
            log_printf(
                "BLE pairing: passkey=%" PRIu32 "\n",
                sm_event_passkey_display_number_get_passkey(packet)
            );
            break;

        case SM_EVENT_PAIRING_STARTED:
            ble_pairing = true;
            log_printf("BLE pairing started\n");
            break;

        case SM_EVENT_PAIRING_COMPLETE: {
            uint8_t status = sm_event_pairing_complete_get_status(packet);
            ble_pairing = false;
            ble_bonded = status == ERROR_CODE_SUCCESS;
            log_printf(
                "BLE pairing complete: status=%u reason=%u bonded=%u\n",
                (unsigned)status,
                (unsigned)sm_event_pairing_complete_get_reason(packet),
                ble_bonded ? 1u : 0u
            );
            if (!ble_connected) {
                ensure_ble_advertising();
            }
            break;
        }

        case SM_EVENT_REENCRYPTION_COMPLETE: {
            uint8_t status = sm_event_reencryption_complete_get_status(packet);
            if (status == ERROR_CODE_PIN_OR_KEY_MISSING) {
                bd_addr_t addr;
                sm_event_reencryption_complete_get_address(packet, addr);
                bd_addr_type_t addr_type = sm_event_reencryption_complete_get_addr_type(packet);
                log_printf(
                    "BLE re-encryption missing key for %s, deleting stale bond\n",
                    bd_addr_to_str(addr)
                );
                gap_delete_bonding(addr_type, addr);
                ble_bonded = false;
            } else {
                log_printf("BLE re-encryption complete: status=%u\n", (unsigned)status);
            }
            break;
        }

        default:
            break;
    }
}

static void setup_ble_indicator(void) {
    l2cap_init();
    sm_init();
    sm_set_io_capabilities(IO_CAPABILITY_NO_INPUT_NO_OUTPUT);
    sm_set_authentication_requirements(SM_AUTHREQ_SECURE_CONNECTION | SM_AUTHREQ_BONDING);

    att_server_init(profile_data, att_read_callback, att_write_callback);

    bd_addr_t null_addr;
    memset(null_addr, 0, sizeof(null_addr));
    gap_advertisements_set_params(0x0030, 0x0030, 0, 0, null_addr, 0x07, 0x00);
    gap_advertisements_set_data(sizeof(adv_data), (uint8_t *)adv_data);
    gap_advertisements_enable(1);
    ble_advertising = true;

    hci_event_callback_registration.callback = &packet_handler;
    hci_add_event_handler(&hci_event_callback_registration);

    sm_event_callback_registration.callback = &packet_handler;
    sm_add_event_handler(&sm_event_callback_registration);

    log_printf("BLE indicator advertising as %s\n", DEVICE_NAME);
}

int main(void) {
    sleep_ms(100);
    stdio_init_all();
    log_printf("Boot: Codex Pico BLE indicator starting\n");

    if (cyw43_arch_init()) {
        log_printf("Wi-Fi/Bluetooth stack init failed\n");
        return 1;
    }
    cyw43_ready = true;
    state_entered_at = get_absolute_time();
    update_status_led();
    log_printf("Wi-Fi/Bluetooth stack init complete\n");

    setup_ble_indicator();
    hci_power_control(HCI_POWER_ON);

    absolute_time_t next_advertising_recover = make_timeout_time_ms(ADVERTISING_RECOVER_MS);
    while (true) {
        poll_bootsel_recovery_button();
        update_status_led();

        if (time_reached(next_advertising_recover)) {
            ensure_ble_advertising();
            next_advertising_recover = make_timeout_time_ms(ADVERTISING_RECOVER_MS);
        }
        tight_loop_contents();
        sleep_ms(1);
    }
}
