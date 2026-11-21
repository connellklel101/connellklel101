# Novel Checker

A website you upload a novel to. It checks the book and gives you a report covering:

- **Continuity**:
  - Looks: eye and hair colour, height and build, scars and tattoos on the wrong side, glasses, accents.
  - Ages that go backwards or don't match a stated birth year ("born in 1920", so 81 in 1997 is wrong).
  - Names spelled two ways ("Katherine" and "Catherine").
  - Family that changes ("Katherine's husband, Walter" then "Katherine's husband, Albert"), and belongings that change colour (a green car that turns blue).
  - A character who dies and later speaks.
  - **Pronoun slips** ("Tom shook her head" when Tom is "he" everywhere else).
  - **Point-of-view slips** (a stray "I" in a third-person book) and **tense slips** ("He looks up" in a past-tense chapter).
  - **Calendar**: dates that fell on a different weekday, impossible dates (February 30), days that don't add up ("On Monday… The next day, Wednesday"), seasons and holidays that don't fit the month (summer in March, Christmas in July), and time that goes backwards outside a flashback.
- **Spelling**: words not in the dictionary, with suggestions; words spelled two ways ("grey" and "gray"); inconsistent hyphens ("ice-cream" and "ice cream"). US or UK English.
- **Grammar**: "could of", "rather then", "a apple", "the the", "its not", lower-case "i", missing spaces, unclosed quotation marks and more.
- **Style**: repeated phrases, echoes (the same word twice close together), sentences that all start the same way, long sentences, adverbs, filter words, passive voice, overused gestures (nodding, shrugging, sighing), readability score, dialogue share and chapter lengths.
- **Characters**: every name found, sorted into people and places, how often they appear in each chapter, and what the book says about them (looks, age, birth year, marks, glasses, accent, family and belongings).
- **Timeline**: every date, weekday, season and time jump, chapter by chapter, plus the story's running calendar ("Chapter 3: on or after Mon 17 Mar 1997").

Then you can work through the notes:

- **Read with notes**: read each chapter with every note underlined in place. Tap one to see what it says.
- **Download for Word**: get your manuscript back with every note as a Word comment in the margin. If you uploaded a .docx, the comments are added to your own file, so its formatting stays exactly as it was. It also opens in Google Docs and Pages.
- **Story bible**: on the Characters tab, write down the facts you've decided for a character (pronouns, eyes, hair, year born, height, build, handedness, glasses, accent, scars). The book is then checked against them.
- **Check again**: re-check after editing your settings or story bible, or upload a new draft. The report shows which notes have gone since last time and marks the new ones.
- **Dialogue is checked gently**: slang and dialect inside quotation marks ("gonna", "goin'") aren't flagged, and grammar notes there become suggestions. Real typos ("teh", "definately") are still caught. You can turn this off in Settings.
- **Southern hemisphere**: a setting that flips the season check, so summer falls in December.

It uses **no AI and has no running costs**. The checks are rules and word lists, and they run in your browser. **Your book never leaves your device**, unless you switch on the optional online grammar check, which sends the text to [LanguageTool](https://languagetool.org)'s free service.

It reads **Word (.docx), PDF, EPUB and plain text (.txt, .md)** files, or text you paste in. Old `.doc` files and Pages documents need to be saved as `.docx` first.

## Using it on a Samsung phone

1. Open the site's address in Samsung Internet or Chrome.
2. Open the browser menu and choose **Add page to → Home screen** in Samsung Internet, or **Add to Home screen** / **Install app** in Chrome.
3. It now has its own icon and opens like an app. After the first visit it also works offline.

To check a book, tap **Choose your manuscript** and pick the file from your phone, Google Drive or Samsung Cloud.

## Putting it online for free with GitHub Pages

The site is plain files with no server code, so any static host works. With GitHub Pages:

1. Put the contents of this `novel-checker` folder in a GitHub repository (the folder itself, or its contents at the top level of a new repository).
2. On GitHub, open the repository's **Settings → Pages**.
3. Under **Build and deployment**, choose **Deploy from a branch**, pick your branch (usually `main`) and the `/ (root)` folder, then **Save**.
4. After a minute or two the site is live at `https://<your-username>.github.io/<repository-name>/`. Add `novel-checker/` to the end if you left the files inside this folder.

## Trying it on your own computer

Browsers block some features on pages opened straight from a file, so serve the folder instead:

```
cd novel-checker
python3 -m http.server 8000
```

Then open <http://localhost:8000>.

## How good is it?

The checks follow fixed rules and don't understand the story, so:

- It **catches** the mechanical slips that are easy to miss in a long manuscript, like the ones above.
- It **can't** judge plot logic it has no rule for (a character knowing something they never found out, someone in two places at once) or give a real critique of pacing and character.
- It **will** flag some things that are fine, especially in dialogue, dialect and deliberate repetition. Every note has an **Ignore** button. **Add to my words** stops a name being flagged as a spelling mistake, and **Not a character** removes a place name from the character list.

Tested on a 212,000-word novel: the report took about 6 seconds in a desktop browser. Expect a few times longer on a phone.

## Files

| Path | What it is |
|---|---|
| `index.html`, `css/styles.css` | The page |
| `js/app.js` | Page logic: uploading, the report, settings, history |
| `js/importers.js` | Reads .docx, .pdf, .epub and .txt files into paragraphs |
| `js/languagetool.js` | The optional online grammar check |
| `js/storage.js` | Saves settings, past reports and the book's text in the browser |
| `js/annotate.js` | Works out where each note sits in the text |
| `js/docx-export.js` | Builds the Word file with notes as comments |
| `engine/analyzer.js` | All the checks. Plain JavaScript, no dependencies |
| `engine/worker.js` | Runs the checks in the background so the page stays responsive |
| `dict/` | US and UK English Hunspell dictionaries |
| `vendor/` | Libraries: [nspell](https://github.com/wooorm/nspell) (spelling), [mammoth](https://github.com/mwilliamson/mammoth.js) (Word), [pdf.js](https://github.com/mozilla/pdf.js) (PDF) and [JSZip](https://github.com/Stuk/jszip) (EPUB). Licences are in `vendor/licenses/` |
| `samples/salt-and-lantern.txt` | A short story with planted mistakes, used for the example report and the tests |
| `sw.js`, `manifest.webmanifest`, `icons/` | Lets it install to a home screen and work offline |

## Tests

```
node tests/engine.test.mjs
```

This checks that every mistake planted in the sample story is found, and that some correct text is not flagged.
