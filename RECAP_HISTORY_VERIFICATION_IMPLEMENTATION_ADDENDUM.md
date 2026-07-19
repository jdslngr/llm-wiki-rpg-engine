# Addendum: Phase 4 verifier correction

Read `RECAP_HISTORY_VERIFICATION_IMPLEMENTATION_PLAN.md` first. This addendum
is part of that handoff and overrides its Phase 4 file list and steps.

The review found one additional, confirmed verification defect: when
`verify-endstate.ts` is launched from repository root using the documented
form, its two nested smoke tests execute `npx tsx src/...` with the repository
root as their working directory. Both then fail with `ERR_MODULE_NOT_FOUND`.
The parent reports 29 passed and 2 failed, so the claimed 31 passing end-state
checks are not currently reproducible from the repository root.

Add `server/src/verify-endstate.ts` to Phase 4. Before the full release suite:

1. Resolve the `server/` directory from `import.meta.url` using Node URL/path
   helpers.
2. Set that directory as the child command's `cwd` in `runSmokeTest`, or pass
   an equally robust absolute verifier path.
3. Keep child-process failures visible; do not turn the two checks into ignored
   failures.
4. Launch the parent from repository root using
   `npm --prefix server exec -- tsx server/src/verify-endstate.ts` and confirm
   its own checks plus both nested smoke tests pass.
5. Record this fix and its output in the Phase 4 row of the primary plan, then
   commit this addendum with the Phase 4 commit if it remains untracked.

The Postgres-specific `verify-store-deletion.ts` was also attempted during this
review. No `DATABASE_URL` was configured, so it correctly refused to run
against the in-memory fallback. It remains required only when a disposable
Postgres database is available, as the primary plan states.
