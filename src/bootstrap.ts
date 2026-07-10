import { installBrowserShortcutBridge } from "./services/browserShortcuts";

// This entry intentionally runs before React is imported. It lets browser
// preview shortcuts be captured during startup and then replayed by App once
// the first React commit is ready.
installBrowserShortcutBridge();
void import("./main");
