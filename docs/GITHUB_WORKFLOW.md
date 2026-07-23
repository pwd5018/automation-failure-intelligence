# GitHub and Vercel Change Workflow

This repository is connected to:

`https://github.com/pwd5018/automation-failure-intelligence.git`

Changes should be published through the GitHub integration as part of the same work session. Do not leave completed work only in the local workspace.

## Remote-first strategy

1. Inspect the current repository, default branch, open work, and deployment status through GitHub.
2. Create a focused branch from `main` using the convention `agent/<short-description>`.
3. Make and validate the change in the assigned workspace.
4. Transfer the complete intended file set to the remote branch through the GitHub integration.
5. Open a draft pull request targeting `main`. Include the scope and validation results.
6. Mark the pull request ready after local tests pass and the Vercel preview is ready.
7. Merge the pull request into `main` through GitHub.
8. Verify the resulting Vercel deployment, especially `/api/health` and persistence behavior.

## Missing local Git metadata

If `.git` is missing, empty, or Git reports that the workspace is not a repository, do not run `git init`, guess a remote, or clone a second working copy. Use the GitHub integration to create the branch and publish the local files directly. The existing local changes remain the source to transfer.

## Scope and safety

- Publish only files belonging to the requested change.
- Keep commits or remote file updates under one focused phase/feature description.
- Never push directly to `main` when a pull request branch can be used.
- Do not include credentials, database URLs, generated dependencies, or unrelated workspace files.
- Run `npm test` before requesting merge.
- Treat a ready Vercel preview as deployment evidence, but confirm production `/api/health` reports `storage: "postgres"` before claiming persistence is verified.

## Phase handoff record

After merge, record the PR URL, merge commit, test result, and any remaining deployment gate in `ROADMAP.md`. This keeps the next session able to continue from GitHub and the roadmap without reconstructing local history.
