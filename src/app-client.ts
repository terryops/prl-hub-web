// Opened from the iOS / Mac app: its links to this site carry ?client=apple. App Review
// (guideline 3.1.1) bars pointing app users to another way to pay, so for the rest of this
// tab's session Pro is described but not sold here: no price, no PRL checkout. A visit that
// starts on the site itself is unaffected.
const KEY = "pearlhub.client";
export function appClient(search = typeof location === "undefined" ? "" : location.search): boolean {
  const flagged = new URLSearchParams(search).get("client") === "apple";
  try {
    if (flagged) sessionStorage.setItem(KEY, "apple");
    return flagged || sessionStorage.getItem(KEY) === "apple";
  } catch {
    return flagged;
  }
}
