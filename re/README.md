# Reverse Engineering

This folder contains all the research of my RE efforts, categorised into `brands`, `oems` and `protocols`.

A single `brand` can use multiple `oems` and multiple `protocols` - even a single `oem` may provide multiple `protocols`.

Grouping usually happens based on the source code of the RE'd apps. For example, Actions Technologies with their ATS chips, provide a single XLX protocol library with multiple variants and sub-variants. The protocols use roughly the same scheme, but rely on different BLE characteristics and preambles.
