# Windows 2.0.1 Preview 2

- Today, Yesterday and Last 30 Days now use token activity returned for the signed-in Codex account, including other devices. Historical account buckets are imported rather than discarded.
- Missing days display **Not reported** instead of false zero tokens or dollars. Last 30 Days sums only the daily buckets the service returns; it is not guaranteed to be a complete billing-month total.
- The account service does not return daily USD costs. Linux dollar estimates depend on local Linux session logs and cannot be inferred accurately from aggregate account tokens.
- Removed local session scanning from the account refresh path, reducing disk and CPU work on Windows.
- Share now saves an actual PNG under Pictures/Shadowokx Panel and opens the folder with the image selected. The button recovers after failures and prevents duplicate exports.
- Regression checks cover remote history, absent versus zero data, date boundaries, account row rendering, PNG export and export failure recovery, alongside tab switching and hidden UI checks.

This is a Windows prerelease. Account service reporting delays or unavailable daily buckets remain visible as missing data. Linux files and user session data are not bundled.
