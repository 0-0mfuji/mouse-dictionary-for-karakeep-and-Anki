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

### Great JavaScript libraries

- See [package.json](./package.json) and [license.html](https://github.com/wtetsu/mouse-dictionary/releases)

## See also

[Chrome 拡張の高速な英語辞書ツールをつくりました](https://qiita.com/wtetsu/items/c43232c6c44918e977c9)(a Japanese tutorial)
