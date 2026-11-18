# BookNest (web app)

<img src="icons/icon-192.png" width="96" alt="BookNest icon: a white open book on black">

An eReader with folders. It runs in Safari and can be added to your iPhone Home Screen, where it opens full-screen like a regular app and works offline. It doesn't need the App Store.

## Features
- **Folders inside folders.** Create, rename, move and delete them. Press and hold a book or folder for options.
- **Add books from the Files app:** EPUB, PDF, TXT and Markdown. On a computer you can also drag files onto the window.
- **Light or dark library:** tap the sun/moon button at the top of the library to choose Light, Dark or Automatic (matches your iPhone).
- **Sort** by Title (ignoring "The", "A" and "An"), Author (last name first), File Name, Date Added or Recently Read. Grid or list view, and search by title, author or file name.
- **To Read list.** Press and hold any book and choose **Add to To Read**. The list collects marked books from every folder in one place, and marked books get a bookmark ribbon on the cover.
- **Remembers where you stopped in every book**, with a "Continue Reading" shelf and a % read bar on each book.
- **Reader:**
  - Themes: Auto, Light, Sepia, Gray, Dark and Black.
  - Fonts and text: 9 fonts, plus size, line spacing, margins, justification and hyphenation.
  - Pages or scrolling, a table of contents and a progress slider.
  - **Bookmarks:** tap the bookmark button to mark the page (a red ribbon shows on bookmarked pages; tap again to remove). See them all under Contents → Bookmarks.
  - **Find:** tap the magnifier to search the whole book. Tap a match to jump to it highlighted, then step through matches with ‹ ›.
  - Tap the left or right edge, swipe, or use the arrow keys to turn pages. Tap the middle to show the controls.
- **iPhone Duo:**
  - Folded, it's a phone layout. Unfolded (any screen 600 or more points wide), you get a folder sidebar and a two-page book spread with an adjustable center gutter.
  - Folding or unfolding mid-book keeps the same passage on screen.

Your books are stored in the browser's storage on your device. They aren't uploaded anywhere.

## Importing a whole folder
Tap **+ → Import Folder…**.
- **iPhone:** in the Files app, press and hold the folder and tap **Compress**, then choose the `.zip` it makes. Choosing a `.zip` with **Add Books** works too.
- **Computer:** pick the folder directly, or drop a `.zip` onto the window.

BookNest recreates the folder and all its subfolders inside the folder you're viewing, and ignores files that aren't books. Importing the same folder again merges into the existing folders and only adds books you don't already have.

## Backups
Tap **⋯ → Back Up Library…**, then choose **Save to Files** on the Share sheet. The backup is a small `.json` file holding your folders, book list, reading progress and settings. The book files themselves stay in the Files app and are never touched.

To recover, tap **⋯ → Restore from Backup…** (or **Restore from a backup** on the welcome screen) and choose the file. Everything comes back, and books show **File needed** until you add their files again from Files. You can pick them all at once. BookNest recognises each book by its contents and puts it back in its folder with your place kept. Restoring never deletes anything already in BookNest.

## Put it online with GitHub Pages
1. Create a repository on GitHub (for example `booknest`) and upload everything in this folder to it.
2. In the repository, go to **Settings → Pages**. Under "Build and deployment", choose **Deploy from a branch**, then pick `main` and `/ (root)`, and tap **Save**.
3. After about a minute the app is live at `https://<your-username>.github.io/booknest/`.

## Add it to your iPhone Home Screen
Open that address in **Safari**, tap **Share**, then tap **Add to Home Screen**.

## Notes
- Add books from inside the Home Screen app, not from a Safari tab. iOS keeps the storage for the two separate.
- When you change any app file, bump `VERSION` in `sw.js` so phones pick up the update.
- Bundled libraries: [JSZip](https://stuk.github.io/jszip/) (MIT) and [pdf.js](https://mozilla.github.io/pdf.js/) (Apache 2.0). Their licenses are in `vendor/`.
