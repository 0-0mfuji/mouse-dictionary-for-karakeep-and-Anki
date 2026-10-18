<p align="center">
  <img width="400" src="https://github.com/wtetsu/mouse-dictionary/blob/images/logo.png" alt="Mouse Dictionary logo" />
  <br/>
  <h1>Mouse Dictionary for Karakeep and Anki</h1>
</p>

<p align="center">
  <a href="https://github.com/wtetsu/mouse-dictionary/actions?query=workflow%3ATest"><img src="https://github.com/wtetsu/mouse-dictionary/workflows/Test/badge.svg" alt="Test" /></a>
</p>

Mouse Dictionary for Karakeep and Anki is a customized fork of [Mouse Dictionary](https://github.com/wtetsu/mouse-dictionary) that adds seamless integration with **[Karakeep](https://karakeep.com/)** and **[Anki](https://apps.ankiweb.net/)**.

In addition to Mouse Dictionary's super fast, offline-first lookup, this extension allows you to save lookup words directly to Karakeep and export your saved vocabulary lists into Anki decks for spaced-repetition learning.

---

[日本語の説明は以下にあります](#japanese-readme)

---

## Features

- **⚡ Super Fast Lookup**: Inherits Mouse Dictionary's original 1/60s quick response time.
- **💾 Save to Karakeep**: Hover over the dictionary window and click the save button (`💾`) to instantly bookmark a word, its translation, and the page URL to Karakeep.
- **🖍️ Mark Highlights**: Highlight text in articles and click the highlight button (`🖍️`) to create notes/highlights directly saved to Karakeep.
- **🗃️ Export to Anki**: Generate an Anki Deck package file (`.apkg`) directly from your saved Karakeep notes and highlights for immediate import. Duplicate entries of the same word are automatically merged (using `<hr>`).

## How to Set Up

1. **Configure Karakeep Settings**:
   - Go to the Mouse Dictionary settings (right-click the extension icon and select "Options").
   - Scroll down to the **Karakeep integration** section.
   - Enter your **Karakeep URL** and your **Karakeep API Key**.
   - (Optional) Set the **Tag to attach when saving a word** (defaults to `vocab`).
   - Select your preferred **Highlight color**.
2. **Grant Permissions**:
   - Click the **"Grant access"** button to allow the extension to communicate with your Karakeep instance.
3. **Save Settings**:
   - Click the **"Save settings"** button. Now you will see `💾` and `🖍️` buttons next to lookup entries in the dictionary popup.

## How to Export to Anki

1. Open the Mouse Dictionary options page.
2. Scroll to the **Karakeep integration** section.
3. Click the **"Export to Anki"** button.
4. An `.apkg` file (e.g., `karakeep-vocab.apkg`) will be generated and downloaded.
5. Open Anki, choose **File -> Import**, and select the downloaded `.apkg` file to import all your saved words.

---

## <a name="japanese-readme"></a>日本語説明 (Japanese)

Mouse Dictionary for Karakeep and Anki は、超高速ブラウザ辞書ツールである [Mouse Dictionary](https://github.com/wtetsu/mouse-dictionary) に、**[Karakeep](https://karakeep.com/)** および **[Anki](https://apps.ankiweb.net/)** とのシームレスな連携機能を追加したフォークバージョンです。

辞書引きと同時に、単語を Karakeep に保存したり、保存した語彙リストを Anki デッキパッケージ（`.apkg`）としてエクスポートして学習に役立てることができます。

### 主な機能

- **超高速辞書引き**: 本家 Mouse Dictionary ゆずりの高速応答（約60分の1秒）とスマートな熟語検出。
- **Karakeepへの保存 (💾)**: 辞書ウィンドウ内の `💾` アイコンをクリックして、単語、意味、ページURLを Karakeep にテキスト形式ブックマークとして即座に保存。
- **Karakeepへのハイライト登録 (🖍️)**: 選択範囲を `🖍️` アイコンでマークし、ハイライトやメモを Karakeep に保存。
- **Ankiへのエクスポート**: Karakeep にたまった単語やハイライトを自動収集し、Anki に直接インポート可能なデッキファイル（`.apkg`）を作成してダウンロード可能。同一単語の重複登録は自動的に `<hr>` でマージされます。

### セットアップ方法

1. **Karakeep設定**:
   - 拡張機能のアイコンを右クリックして「オプション」を開きます。
   - **Karakeep連携** セクションまでスクロールします。
   - **Karakeep URL** と **Karakeep APIキー** を入力します。
   - 保存時に付けるタグ（デフォルト: `vocab`）やハイライトの色を設定します。
2. **アクセス権の許可**:
   - **「アクセスを許可」** ボタンをクリックし、拡張機能が Karakeep URL と通信できるように権限を承認します。
3. **設定の保存**:
   - 「設定を保存する」ボタンをクリックします。これで辞書表示時に `💾` や `🖍️` アイコンが表示されるようになります。

### Ankiへのエクスポート手順

1. オプション設定画面を開きます。
2. **Karakeep連携** セクションへ移動します。
3. **「Ankiにエクスポート」** ボタンをクリックします。
4. しばらくすると `.apkg` ファイル（`karakeep-vocab.apkg`）が作成され、ダウンロードされます。
5. Ankiアプリを起動し、**「ファイルを読み込む」** からダウンロードしたファイルを選択してインポートします。

---

## How to develop

### Preparation

Use [Node.js](https://nodejs.org/en/download/) 24+.

```sh
npm install
```

### Build

For Chrome:

```sh
npm run build-chrome   # Debug build
npm run release-chrome # Release build
```

For Firefox:

```sh
npm run build-firefox   # Debug build
npm run release-firefox # Release build
```

For Safari:

```sh
npm run build-safari   # Debug build
npm run release-safari # Release build
```

see [package.json](./package.json) for other commands.

## Contribution

For the moment, Mouse Dictionary project doesn't have any strict rule about contribution. Feel free to create any issues and pull requests.

Some guides:

- Editor: the main developer uses VSCode
- Before you commit: try running `npm run test` and `npm run lint`

## Cross-extension messaging

Mouse Dictionary supports receiving [cross-extension messages](https://developer.chrome.com/extensions/messaging). [Mouse Dictionary iframe support](https://github.com/wtetsu/mouse-dictionary-iframe) is a good example that implements message sending to this extension.

Here is a code example for sending a message to Mouse Dictionary. You can make Mouse Dictionary look up words/expressions from other extensions.

```js
const MD_EXTENSION_ID = "dnclbikcihnpjohihfcmmldgkjnebgnj";

chrome.runtime.sendMessage(MD_EXTENSION_ID, {
  type: "text",
  text: "rained cats and dogs",
});
```

Parameters:

| name | type   | value                    |
| ---- | ------ | ------------------------ |
| type | string | must be "text"           |
| text | string | text you want to look up |

## Settings and languages

The settings screen uses a neutral Material 3 theme and the Mouse Dictionary for Karakeep and Anki brand mark. Choose **日本語** or **English** at the top of settings; Japanese is the default. Changes save automatically and the selected language also applies to new AI feedback and voice transcription. Existing dictionary definitions and saved content retain their original language.

UI text and AI instructions are maintained in `src/i18n/locales/<language>/translation.json`. See [the translation guide](src/i18n/README.md) to add another language. The display preview stays inside its own scrollable settings card, so large dictionary windows do not overlap navigation. The version number links to this repository.

## Writing mode

Open writing mode from settings to create documents or import Markdown/text files. AI identifies passages to reconsider and asks questions without writing replacements. Local checks flag filler words, repeated phrases, passive voice, and nominalizations. Documents, revision history, and review-method comparisons are saved locally. You can compare revisions, view differences, export Markdown, and configure the OpenAI model in settings. OpenAI requests require your API key and may incur API charges.

## Karakeep RSVP Reader

On a Karakeep Reader page, use **RSVPで読む** to open the saved article in a separate extension tab. The reader captures the article text from the page and analyzes it locally in a Web Worker with the bundled UDPipe WebAssembly parser.

Video transcripts with leading timestamps (for example, `00:08` or `02:25`) are detected automatically. The reader removes the timestamps and transcript heading, then joins caption lines split in the middle of a sentence. It keeps an offset mapping back to the original Karakeep text for reading progress and highlights. Ordinary article text is left as-is.

The first sentences become readable after their dictionary entries load; the rest load in the background. Reading position uses offsets in the original article, so later phrase grouping does not move it. Text that cannot be aligned to the parser output stays in the reader with an **解析なし** label instead of disappearing. If the parser itself is unavailable, the article remains readable in source order without syntax labels.

Reading positions sync with Karakeep **0.33.2** using the configured instance URL and API key (bookmark read/write access). The extension keeps an exact word position locally, while Karakeep receives the corresponding paragraph and reading percentage. Progress is saved every three seconds while reading and on pause, page hide, and the reader's Close button. Browsing the sentence picker without confirming does not change the position.

On reopening, a changed Karakeep position takes precedence; otherwise the local word position is restored. Local positions are scoped to the instance and API key and checked against the article text. Failed syncs keep the local position and retry while the reader is open or when it is reopened. The status above the reader reports sync failures. Reload an already-open Karakeep reader to fetch the updated position; its existing Continue Reading banner is not updated live. The localhost design preview uses sample text and does not connect to Karakeep.

The progress adapter uses the `bookmarks.getReadingProgress` and `bookmarks.updateReadingProgress` tRPC procedures from Karakeep 0.33.2. These are version-specific internal endpoints; the REST bookmark update API does not expose reading progress. Paragraph anchors and per-text-node normalized offsets follow that version's `reading-progress-dom.ts`. When a paragraph cannot be mapped, the extension keeps the position locally instead of sending a guessed offset.


- Space toggles playback, W/S changes speed, A/D moves one reading unit, and Q/E moves one sentence. The speed slider is also available. Longer phrases remain on screen longer.
- Use the **訳 表示中 / 非表示** toggle to choose whether glosses remain visible, then select **この文に答える** to explain the sentence briefly in Japanese. Glosses can also be shown or hidden while answering. Type the answer or record it with the microphone; a multilingual Whisper Tiny model transcribes Japanese locally in a worker, using WebGPU when available and WASM otherwise. The first use downloads model weights from Hugging Face and caches them in the browser. Check or edit the transcript before submitting. The original sentence, parser hints, and glosses remain available after submission. Reviews of answers that used glosses are labeled accordingly; their scores do not represent unaided recall.
- In Mouse Dictionary settings, enter an OpenAI API key and select a review model (default: `gpt-6-luna`). The key is stored in extension local storage; the model selection syncs with other settings. Grant OpenAI and Hugging Face host access using the adjacent buttons. Submitting a response sends the English sentence and Japanese answer to the OpenAI Responses API. The review shows a natural Japanese model answer, weighted comprehension points with English evidence, specific corrections, and explained nuances. The displayed score is calculated from the point judgments (understood: full, partial: half, missing/misunderstood: zero; uncertain speech recognition is excluded). Click an underlined part of the Japanese answer to open its English correspondence and correction in a popover. Scores remain study guidance, not a validated exam grade. API use is billed to the configured OpenAI account.
- **履歴** beside **閉じる** opens a separate extension tab with recent answers. The English sentence, parser hints, submitted Japanese answer, and any returned AI review are saved locally when the answer is submitted; the most recent 100 entries are kept. History does not store the API key or audio recording.
- Reviews include up to one preceding and one following English sentence as context for pronouns and ellipsis; only the selected sentence is graded. The context sent for a review can be expanded in its history entry. The history page shows per-answer and retained-history token usage reported by the Responses API: input, cache reads and writes, output, and reasoning tokens. Older calls and requests without a returned usage record cannot be reconstructed from the extension.
- If the same sentence, answer, input method, gloss condition, surrounding context, model, and review prompt version have already produced a review, the reader reuses that saved result without another API request. Repeated submission while a review is in progress is ignored. The reader and history label reused reviews so a zero-call entry is distinguishable from an unreviewed answer.
- The **再生方法** selector offers normal playback or sentence-by-sentence answer mode with text or voice. Voice mode opens the microphone only when recording starts after each sentence and releases it as soon as recording ends; transcription runs after release. Cancelling, changing modes, navigating, or hiding the reader also releases the microphone. Text mode focuses the answer field. Review the answer before continuing to the next sentence. The active English word can be spoken using the browser's English speech voice. The **その他** menu contains pronunciation voice selection and review marks; **次の再読文へ** jumps among marks, and the sentence picker labels them. The **語句・保存** menu contains phrase splitting, Karakeep marking, and Anki card creation.
- Dictionary phrases that cross clear clause boundaries are ignored. While paused, **語句を分ける** splits an incorrectly joined phrase into reading units; **語句をまとめる** restores it. The choice is saved locally for the article.
- Inline EIJIRO meanings are labeled by grammatical evidence. **品詞一致** means the parser matched the dictionary part of speech, not that the meaning was verified in context; **複数候補** means several meanings remain. Anki cards include this caveat.
- While paused, the reader shows the full sentence, dependency arcs and labels, approximate S/V/O/C roles, the current EIJIRO entry when present in the existing local dictionary, and the sentence as an example.
- **この語を穴抜きカードにする** downloads an Anki `.apkg` with a cloze deletion, dictionary text, dependency label, and source link when available. Import the file into Anki.
- Karakeep’s configured URL and API key stay in the existing extension settings. The reader uses those saved settings and does not create a second set of credentials.

The bundled English GUM model is licensed under **CC BY-NC-SA 4.0**; it may not be included in commercial distributions. See `reader/wasm/LICENSES.txt` in the built extension before redistributing it. The UDPipe runtime is MPL-2.0.
The local speech runtime uses [Transformers.js](https://github.com/huggingface/transformers.js) (Apache-2.0) and [ONNX Runtime Web](https://github.com/microsoft/onnxruntime) (MIT). The multilingual Whisper Tiny model is downloaded from [Hugging Face](https://huggingface.co/onnx-community/whisper-tiny) on first use.

The review prompt assesses meaning units and distinguishes likely speech recognition errors from comprehension errors. It avoids deductions for valid paraphrases. Its structured output lets the UI pair a specific Japanese phrase with the corresponding English evidence. This follows the [OpenAI structured output guidance](https://developers.openai.com/api/docs/guides/structured-outputs), the [OpenAI Cookbook's meaning-based speech translation evaluation](https://github.com/openai/openai-cookbook/blob/main/examples/voice_solutions/realtime_translation_guide.mdx), and [Hacker News discussion of criterion-based grading](https://news.ycombinator.com/item?id=46697826). Browser-side Whisper with GPU and CPU fallback was also [discussed on Hacker News](https://news.ycombinator.com/item?id=47056363). The prompt needs calibration against human-rated examples before the score should be treated as a formal assessment.

## License

Mouse Dictionary is published under the MIT license.

## Third-party data

This project includes some third-party data:

### Dictionary data

- [ejdict-hand](https://github.com/kujirahand/EJDict) (Public Domain)

### Images

- [WPZOOM Developer Icon Set](https://www.iconfinder.com/iconsets/wpzoom-developer-icon-set) ([CC BY-SA 3.0](https://creativecommons.org/licenses/by-sa/3.0/))
- [Heroicons UI icon set](https://www.iconfinder.com/iconsets/heroicons-ui) ([MIT](https://opensource.org/licenses/MIT))

### Built-in PDF viewer

- [Mouse Dictionary's built-in PDF viewer](https://github.com/wtetsu/pdf.js) is based on [PDF.js](https://github.com/mozilla/pdf.js) ([Apache-2.0](https://github.com/mozilla/pdf.js/blob/master/LICENSE))

### RSVP grammar parser

- [UDPipe](https://github.com/ufal/udpipe) (MPL-2.0) and its English GUM model (CC BY-NC-SA 4.0; non-commercial use only; see `static/base/reader/wasm/LICENSES.txt`)

### Great JavaScript libraries

- See [package.json](./package.json) and [license.html](https://github.com/wtetsu/mouse-dictionary/releases)

## See also

[Chrome 拡張の高速な英語辞書ツールをつくりました](https://qiita.com/wtetsu/items/c43232c6c44918e977c9)(a Japanese tutorial)
