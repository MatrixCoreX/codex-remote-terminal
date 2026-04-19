cmake_minimum_required(VERSION 3.13)

if(NOT DEFINED PICO_SDK_PATH AND DEFINED ENV{PICO_SDK_PATH})
    set(PICO_SDK_PATH $ENV{PICO_SDK_PATH})
endif()

if(NOT DEFINED PICO_SDK_PATH)
    message(FATAL_ERROR "Set PICO_SDK_PATH to your local pico-sdk path.")
endif()

if(NOT DEFINED PICO_BOARD)
    set(PICO_BOARD pico2_w CACHE STRING "Target board")
endif()

include(${PICO_SDK_PATH}/external/pico_sdk_import.cmake)

project(codex_pico_ble_indicator C CXX ASM)
set(CMAKE_C_STANDARD 11)
set(CMAKE_CXX_STANDARD 17)

pico_sdk_init()

add_executable(codex_pico_ble_indicator
    src/codex_pico_ble_indicator.c
)

target_include_directories(codex_pico_ble_indicator PRIVATE
    ${CMAKE_CURRENT_LIST_DIR}/src
)

target_compile_definitions(codex_pico_ble_indicator PRIVATE
    PICO_BLE_USB_CDC_ONLY=1
)

target_link_libraries(codex_pico_ble_indicator
    pico_stdlib
    pico_cyw43_arch_none
    pico_btstack_ble
    pico_btstack_cyw43
)

pico_btstack_make_gatt_header(
    codex_pico_ble_indicator
    PRIVATE
    ${CMAKE_CURRENT_LIST_DIR}/src/codex_pico_ble_indicator.gatt
)

pico_enable_stdio_usb(codex_pico_ble_indicator 1)
pico_enable_stdio_uart(codex_pico_ble_indicator 0)

pico_add_extra_outputs(codex_pico_ble_indicator)
