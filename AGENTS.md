# Retry architecture
- Keep provider generation in server-only helpers; authenticated wrappers and scheduled handlers call helpers, never RPC stubs, to preserve Worker boundaries.
- Stage retry schema and cron configuration outside automatically applied migration/deployment paths until explicit approval; execution flags default off to protect existing records.
- Share database-enforced usage reservations and token-fenced queue leases across interactive and scheduled execution; fail closed when enforcement is unavailable.
- Test retry SQL against a disposable local database and provider calls against fakes; never use production queue records in tests.