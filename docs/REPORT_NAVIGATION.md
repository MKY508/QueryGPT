# Report page navigation

`ReportPageNavigator` renders the current page, native page selector and previous/next actions. It accepts only page identities and titles; the workspace owns document state, reading position, filtering and page creation. Saving or refresh locks creation, not navigation.

The desktop navigator uses shared Button and FieldControl styles. Its controls fit the available report pane without switching to mobile navigation. The workspace exposes creation in the outline when expanded, and in the navigator when the outline is collapsed; reading mode exposes neither creation entry.

Component checks cover Chinese/English navigation under mutation locks. Workspace checks cover reading navigation, inherited filters and creating a page in edit mode. Workspace integration remains uncommitted; simulated API checks do not establish real persistence.
