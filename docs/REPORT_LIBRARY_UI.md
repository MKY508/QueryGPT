# Report library UI

The library groups search, status and sort controls following the [PatternFly toolbar guidance](https://www.patternfly.org/components/toolbar/design-guidelines/). Search uses `SearchField`; native selects use `FieldControl`, with fixed desktop widths. Search submission, IME handling, URL state and clearing semantics remain owned by the existing library controls.

The copy task uses the shared 760px `TaskDialog`, 60px header, 12px frame radius and 6px fields/buttons. The session captures the opener before opening. After the initial journal check commits its enabled state, it focuses and selects the editable name, or focuses an available close action when the name is locked. Tab and composing Escape follow the shared frame; closing returns focus to the opener. Copy intent, uncertain-result resolution and journal acknowledgement remain in the existing copy session and services.

Validation: ten targeted copy/recovery/directory checks pass. Actual Chrome at 1180×700 in Chinese and English verifies frame geometry, no horizontal overflow, initial focus, forward/reverse Tab wrapping and Escape return. Browser requests are mocked reads only; tests mock copy writes. This does not verify live copying or a packaged desktop release. The copy service and its index/workspace integration remain in the uncommitted worktree.
