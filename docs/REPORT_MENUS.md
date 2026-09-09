# Report action menus

`ReportActionMenu` owns toolbar menu positioning, keyboard navigation, outside dismissal and trigger-focus restoration. Its trigger uses the shared Button and can show text or an icon. Actions own their business operations; the menu closes and restores focus before invoking an action, so a newly opened task dialog can restore focus to the correct trigger.

The interaction follows the [WAI-ARIA menu-button pattern](https://www.w3.org/WAI/ARIA/apg/patterns/menu-button/). Arrow keys skip disabled items; Escape and Tab return to the toolbar. Composition events and key code 229 do not open, navigate or dismiss the menu. The parent supplies a stable `onOpenChange` callback so content updates do not reset menu focus.

The report workspace's add-content and export integration remains part of the uncommitted workspace refactor. Its browser checks use mocked report reads and do not establish real export or persistence availability.
