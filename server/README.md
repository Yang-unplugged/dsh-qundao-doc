# Independent local document backend

This is a new, isolated application, not a DSH extension or a migration of real user data. Node standard library only; server has no outgoing network calls. No accounts, cloud collaboration, real messages, or permission changes.

## Run

From project root, build frontend with `npm run build`, then `node server/index.mjs`.
Default address: `http://127.0.0.1:4317`.
`PORT=4320 DATA_DIR=/absolute/private/data node server/index.mjs` selects an independent data directory. Default is project `.local-data`, never an inferred old DSH directory. Server always binds IPv4 loopback, irrespective of environment host settings. Do not publish it through a tunnel or reverse proxy: it has no authentication and trusts the local OS user.

API rejects unexpected Host, Origin and cross-site fetches. JSON writes require application/json. Static app CSP blocks external resources and connections; links are still ordinary user-selected external navigation. Development Vite runs separately; production start is the verified same-origin configuration.

## Storage and recovery

`state.json` is a checksummed envelope (`schemaVersion: 1`) around format `dsh-documents-next`, version 3. A single atomic rename commits documents and all history together. A temp file is fsynced before rename; directory is fsynced after. Failure before rename leaves old state; a rare failure after rename means an uncertain committed outcome: reload/read before retry. A process-lifetime exclusive `.lock` prevents concurrent stores using the same directory. Stale locks are **not** automatically removed after forced termination: verify the recorded process is stopped, retain a copy of the data directory, then manually remove only `.lock` to reopen. Never remove a live owner's lock.

Corrupt/truncated/checksum-invalid current data fails closed with `CORRUPT_STORAGE`; no overwriting or silent reset. Restore a separately exported backup to a different empty directory and inspect it. Existing corrupt files remain untouched. Atomic durability depends on the underlying filesystem honoring fsync and atomic rename; network filesystem behavior has not been certified.

Every edit, metadata change, version naming, delete, undelete and history restore appends a revision. History restore copies title/content into a new current revision and leaves prior history intact, preserving current metadata and named-version labels; it does not silently undelete. `expectedRevision` is mandatory for mutations of existing documents. HTTP 409 `CONFLICT` is a stale-save error. The caller must show conflict UI and reload or explicitly reconcile, not silently force-write.

Whole-store snapshots and full content history are intentionally simple. No compaction, pruning, streaming backup or large-library optimization yet. Each save serializes the complete library; this is a prototype for modest libraries, not a proven large repository. Individual content is capped at 8 MiB, nesting at 64 document levels / 128 generic JSON levels, 100,000 nodes / 500,000 JSON entries, title at 300 characters. Generic validated JSON attrs preserve editor metadata, but backend does not claim full ProseMirror semantic schema validation. The editor must validate supported nodes. Unsafe prototype keys and URL schemes are rejected. Data URL images allow PNG/JPEG/GIF/WebP only, never SVG/HTML.

## API

- GET `/api/documents` -> `{documents}` including soft-deleted documents, newest updated first.
- GET `/api/documents/:id` -> `{document}` including soft-deleted document.
- POST `/api/documents` with `{title,content,metadata?}` -> `{document}` (201).
- PUT `/api/documents/:id` with `{title,content,expectedRevision}` -> `{document}`.
- GET `/api/documents/:id/history` -> `{history}` full versions newest first.
- POST `/api/documents/:id/restore` with `{revision,expectedRevision}` -> `{document}`.
- DELETE `/api/documents/:id` with `{expectedRevision}` -> `{document}`.
- POST `/api/documents/:id/undelete` with `{expectedRevision}` -> `{document}`.
- PATCH `/api/documents/:id/metadata` with `{metadata,expectedRevision}` -> `{document}`. Partial metadata merges with existing values.
- POST `/api/documents/:id/named-versions` with `{revision,name,expectedRevision}` -> `{document}`. Naming the same revision again renames its label.
- GET `/api/documents/:id/named-versions` -> `{namedVersions}`.
- GET `/api/backup` -> full `dsh-documents-next` version 3 backup object (not a wrapper).

Every document has id/title/content/revision/createdAt/updatedAt/deletedAt/metadata/namedVersions. Content must be a Tiptap JSON doc with a content array. Deleted state is visible for recovery; ordinary update is blocked until undelete. Errors have `{error,code}`. IDs are generated UUIDs; routes never map caller IDs into paths.

## Backup and restore

Save `/api/backup` JSON while the app is running. It includes all current content, histories, metadata, named-version labels and deletion states. Inline raster images, if present in JSON, are included. Uploaded local assets are included with base64 bytes and SHA-256 checksums; remote URLs are not downloaded or embedded.

`node server/restore.mjs /path/backup.json /path/NEW_EMPTY_DIRECTORY`

Restoration validates format, all document contents, IDs, timestamps and complete contiguous histories before writing. It refuses nonempty destinations; original source and old directory are never modified. Run app using the new DATA_DIR and inspect it before choosing to keep it. This utility does not accept original DSH backups; their real schema is unavailable.

## Old HTML source preservation, not conversion

`node server/import-html-source.mjs /path/source.html /path/new-data 'Source title'`

Reads UTF-8 HTML (up to 4 MiB) and archives it as an escaped editable code block, with an explicit warning paragraph. It never executes HTML, rewrites source, or guesses a prior DSH schema. There is no rendered HTML conversion, old revision-chain migration or old backup compatibility. Invalid UTF-8 is rejected. For true migration, obtain original schema and fixtures and implement a separately tested conversion that preserves untouched originals.

## Tests

`node --test tests/*.test.mjs`

Uses independent temporary data directories and real loopback HTTP. Covers restart, revision conflicts, restore/delete/undelete, concurrent saves, lock exclusion, corrupt-current preservation, full backup roundtrip, invalid backup rejection, unsafe URLs/prototype/depth/size limits, precommit failure, Host/Origin, JSON MIME/body errors, static distribution and CLI source preservation. Not real DSH or Mac validation.

## Metadata and named versions (format v2)

Metadata defaults to `{folder: "", favorite: false, pinned: false, icon: "", cover: ""}`. Folder is a logical slash-separated path (not a disk path), at most 200 characters; empty means root. Empty segments, dot/dot-dot segments, backslashes, control characters and surrounding segment whitespace are rejected. There are no independent empty-folder objects, bulk folder rename or folder permissions. Favorite/pinned are booleans; icon is plain text up to 32 UTF-16 code units. Cover supports an empty string, a six-digit hex color or a local raster image asset URL. Unknown metadata keys are rejected rather than silently discarded.

Named versions are `{revision,name,createdAt}` labels stored with the current document. Names are 1–100 characters; up to 1,000 labeled revisions per document. The named target must already exist; its content remains immutable in history. Naming/renaming appends a document revision with optimistic concurrency protection. Restore copies historical content/title only, never silently moves a document out of its current folder or drops its labels. Naming does not duplicate a standalone snapshot. Historical entries retain the labels as they existed then; use current `namedVersions` to render current labels next to history entries.

Existing independent Next v1 checksummed files are validated and migrated in memory with default metadata and empty labels, retaining every original revision. Merely opening v1 does not rewrite its file; the first successful mutation persists v3. Backup export returns v3. The restore CLI accepts valid independent Next v1/v2/v3 backups, upgrades older versions into the empty destination, and rejects malformed/newer formats before creating the destination. This is not compatibility with the original DSH plugin's unknown backup format. Envelope schema remains 1 because its checksum packaging did not change; payload version is 3. V1 data containing unvalidated v2 fields is rejected rather than silently trusted or discarded.

## Local assets (format v3)

POST `/api/assets` accepts JSON `{name,mime,dataBase64}` and returns 201 `{asset:{id,name,mime,size,createdAt,url}}`. ID is lowercase SHA-256 of bytes; URL is `/api/assets/<id>`. GET/HEAD that URL retrieves verified bytes. Single byte ranges and suffix ranges are supported; invalid/multiple ranges return 416. An If-Range mismatch returns the full file. There is no external upload, outgoing fetch or transcoding.

Files are limited to 20 MiB decoded, 200 MiB total committed assets, and 10,000 assets. Canonical base64 is required. Upload JSON request cap includes base64 expansion plus 64 KiB metadata. Filename is display-only, 1–180 UTF-16 code units without slash/backslash/control characters; disk paths use only validated hashes. Supported MIME types: image/png, image/jpeg, image/gif, image/webp, application/pdf, audio/wav, audio/mpeg, audio/ogg, video/ogg, video/mp4, audio/mp4, video/webm, audio/webm, application/octet-stream. Known formats require matching byte signatures. This is header sniffing, not complete codec parsing, malware scanning or proof of browser playback. SVG/HTML/JavaScript cannot be served inline. PDF and opaque files are forced downloads with nosniff and sandbox CSP; arbitrary files can be uploaded only as application/octet-stream. Raster/audio/video get inline disposition and same-origin resource policy.

Bytes live once at `assets/<sha256>` with a manifest in state.json; autosaves never serialize base64. Identical bytes with the same MIME deduplicate and retain the first filename; conflicting MIME for the same hash is rejected. New bytes are fsynced before the manifest commit. A failed manifest save can leave an unreferenced file, which is neither served nor advertised in backup; no automatic orphan deletion occurs. Retrying validates existing bytes before reuse. Existing committed files are verified at startup/read/backup. Missing, corrupted or symlink asset files fail closed. No asset deletion/garbage collection exists yet, intentionally retaining assets used by history.

V3 full backups include every committed asset, including currently unused uploads. Restore validates all bytes, hashes, signatures, quotas and document asset references before creating an empty destination; live storage retains only descriptors. V1/v2 migrate with empty asset manifests without altering existing history. Incomplete/corrupt backups cannot silently lose media. Disk failure during restoration may leave an incomplete new destination; retain the source and restore into another empty directory. Backup/restore currently buffer the complete library in memory, so near-quota exports require substantial spare memory. Inline legacy image data URLs still work and stay in document JSON.

