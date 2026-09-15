# WaySignal native update

This small installer contains the five Swift fixes from commit `d0a17cc`: bounded page layout, a compact demo badge, and opt-in saved sign-in. It checks source hashes and preserves local edits, backs up the previous files, then runs the existing signed simulator launcher. The backend database and local configuration are unchanged.

Download the ZIP using its raw GitHub URL or the terminal instructions provided with this update. Extract it and run `bash WaySignal-Layout-Fix/apply-update.sh`. Its default project is `~/Downloads/waysignal`; pass a different project path as its first argument if needed.

The `.sha256` file records the ZIP checksum. Source for the fixes remains in `ios/WaySignal/`.
