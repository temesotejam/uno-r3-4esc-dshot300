# Arduino Uno R3 — 4 ESC DShot300 / 可変抵抗コントローラ

**実機で4基のモーターが動作した構成を保存したリポジトリです。** Arduino Uno R3（ATmega328P、16 MHz）から、**単方向DShot300を4系統同時に生成**し、可変抵抗1つで4基へ**同じ**スロットル指令を送ります。SBUSやPicoは使用しません。

## Web書き込みページ（Arduino IDE不要）

**[Arduino Uno R3へUSBで書き込む](https://temesotejam.github.io/uno-r3-4esc-dshot300/)**

- PCの **Google Chrome または Microsoft Edge**（Web Serial対応版）で開いてください。モバイル版ブラウザやFirefox / Safariは非対応です。
- Uno R3のUSBをPCへ接続し、Arduino IDEのシリアルモニタなどCOMポートを使うアプリを閉じてください。
- **ESC用LiPoを取り外し、プロペラも外して**ください。バッテリーを接続したままフラッシュ操作しないでください。
- ページの確認チェックを入れ「接続してUno R3に書き込む」を押し、対象のCOMポートを選びます。
- ページは最新のGitHub ActionsでUno R3向けにビルドした `firmware.hex` を使用し、**STK500v1 / 115200bps** のブートローダー通信で書き込み、フラッシュの読み戻し一致まで検証します。
- 書き込みに失敗した場合、以前のスケッチが不完全になっている可能性があります。その場合はArduino IDEで再書き込みしてください。USB接続だけでなく、従来のブートローダーがArduinoに入っている必要があります。
- GitHub Pagesが未設定の場合は、リポジトリの **Settings → Pages → Build and deployment → Source: GitHub Actions** に切り替える必要があります。[公開ワークフロー](https://github.com/temesotejam/uno-r3-4esc-dshot300/actions/workflows/build-arduino.yml)

このページはWeb Serialを使ってPCからUnoへ直接書き込みます。UNOのUSBデータがサイトのサーバーに送信されることはありません。ファームウェアのコンパイルはGitHub Actions側で行い、ブラウザは生成済みHEXを書き込みます。

## Arduino IDEから書き込む

1. [`UnoR3_Potentiometer_4ESC_DShot300`](./UnoR3_Potentiometer_4ESC_DShot300) フォルダの **`UnoR3_Potentiometer_4ESC_DShot300.ino`** をダウンロードする（またはリポジトリをZIPで取得）。
2. Arduino IDEで `UnoR3_Potentiometer_4ESC_DShot300.ino` を開く。単体で保存した場合、IDEが求める同名フォルダに入れる。
3. **ボード：Arduino Uno**、**ポート：Unoが接続されているCOMポート** を選択する。
4. **アップロード**を実行する。追加ライブラリは不要。
5. 必要ならシリアルモニタ（115200bps）で `A0`、`DShot`、`enabled` を確認する。

[GitHub Actionsのビルド結果](https://github.com/temesotejam/uno-r3-4esc-dshot300/actions/workflows/build-arduino.yml)から、検証済みの `.hex` を含むZIPも取得できます（`arduino-cli` によるビルド成果物）。通常はArduino IDEで上記のINOを書き込む方法が最も簡単です。ブラウザから直接書き込む方法も用意しました（下記「Web書き込みページ」参照）。

## 配線

| Uno R3 | 接続先 |
|---|---|
| 5V | 10kΩ程度の可変抵抗の一端 |
| A0 | 可変抵抗の中央端子（ワイパ） |
| GND | 可変抵抗の反対端 |
| **D8** (PB0) | ESC 1 の信号入力 |
| **D9** (PB1) | ESC 2 の信号入力 |
| **D10** (PB2) | ESC 3 の信号入力 |
| **D11** (PB3) | ESC 4 の信号入力 |
| GND | **すべてのESCの信号GND** |
| D7（任意） | 220〜1000Ω抵抗＋状態表示LED |

ESCの主電源は仕様に適合する別電源（これまでの構成では1S LiPo）から供給してください。UnoはUSBなどの安定した5V電源で動かします。**1S LiPoをUnoの5V端子へ直接接続しないでください。**

**注意：** UnoはDShotの波形生成に `PORTB` 全体を直接書き込みます。D8〜D11が4出力ですが、**D12/D13も他用途・SPIで使わないでください**。D13内蔵LEDは状態表示として使えません。接続前にESC信号端子がUnoの5Vロジック入力に対応することを確認してください。

## 動作

| 状態 | 動作 |
|---|---|
| 電源投入後の3秒 | 4基ともDShot `0` を送信し続ける |
| その後つまみ最小を0.6秒保持 | 操作を許可（アーム前操作防止） |
| A0のADC値0〜40 | 4基とも即座にDShot `0`（停止指令） |
| ADC値約58から | DShot `250` で回転指令を開始 |
| 可変抵抗を上げる | DShot `250〜2047` に変化、4基へ**同一指令** |
| つまみを最小へ戻す | すぐDShot `0` |

- **DShot300**：500フレーム/秒で、D8〜D11を同時に切り替えて4出力を生成。eRPMテレメトリ受信なし（単方向）。
- **A0**：10msごとに読み取り（100Hz）、平滑化と出力変化量制限を適用。
- **ヒステリシス**：ADCが40以下で停止、58以上で回転開始。境界付近でのバタつきを防止。
- **変更用の主な定数**（INO先頭）：`MIN_RUNNING_DSHOT`（250を48にすれば標準の全回転指令範囲）、`POT_STOP_ADC`、`POT_START_ADC`、`SLEW_UP_STEP`、`SLEW_DOWN_STEP`。

## 安全

**プロペラを外した状態で、各チャンネルの波形・回転・停止を確認してください。** 4基同時始動の瞬間には電源電圧が低下する可能性があります。DShot `0` は停止指令であり電源遮断ではありません。緊急時にLiPoを切断できる状態を確保してください。

## ソースとライセンス

- `UnoR3_Potentiometer_4ESC_DShot300/UnoR3_Potentiometer_4ESC_DShot300.ino`：実機動作を確認したオリジナルのArduino IDE用スケッチ（このリポジトリへの登録時に機能変更なし）
- `UnoR3_Potentiometer_4ESC_DShot300/README.txt`：元の配布ZIPの説明文
- `LICENSE`：GPL-3.0。DShotの波形生成部分は以前のスケッチを継承し、その祖先の [arduino-bi-directional-dshot](https://github.com/bird-sanctuary/arduino-bi-directional-dshot) にクレジットがあります。

[ビルドの検証結果](https://github.com/temesotejam/uno-r3-4esc-dshot300/actions/workflows/build-arduino.yml)はGitHub Actionsで確認できます。コンパイルの成功は実機の信号波形の保証ではありません。
