# 第二弾レビュー指摘の修正（2026-11-26）

対象は第二弾ZIP（2026-11-24改訂版）です。修正は新規の候補パッケージにだけ入れています。既存のスプレッドシート、GAS、GitHub Pagesには触れていません。

## 修正内容

| # | 不具合 | 修正 | 変更ファイル |
|---|---|---|---|
| ① | Bridge.html がプライベート関数 `v2Public_` を google.script.run から呼んでおり、公開画面の通信が全滅していた | クライアント用の入口 `v2PublicRpc(req)` を追加し、Bridge からはそれを呼ぶ。公開側の Initialize.gs も削除した（匿名で呼べてしまうため。初期化は管理GASから行う） | public/Web.gs, Bridge.html, public/Initialize.gs（削除） |
| ② | 管理側の manifest にスコープが不足していて、メニュー・ダイアログ・権限確認が動かなかった | `script.container.ui` と `userinfo.email` を追加 | admin/appsscript.json |
| ③ | 管理GASに DiceRules.gs がなく、詳細検証の抽選と担当者名検証が ReferenceError になっていた | 参照保全版の DiceRules.gs（public/admin 同一）を配置 | admin/DiceRules.gs（追加） |
| ④ | 追記を「最終行+1」への updateCells で書いており、1000行のグリッド上限に達すると batch 全体が失敗していた | 追記は appendCells に変更（行が自動で増える）。Dashboard は appendDimension で事前に行を増やし、監査行は appendCells で追記 | Repository.gs（両側）, Analytics.gs |
| ⑤ | appendRow と Sheets API の書込が混在しているのに、ロック解放前の flush がなかった | ロック解放前と batchUpdate 前に `SpreadsheetApp.flush()` を実行 | Repository.gs, Admin.gs, Analytics.gs |
| ⑥ | 読み取りだけの status も全部ロック待ちになっていた。混雑時はエラーログのためにもう一度ロックを待っていた。0時と開催境界には画面が一斉に再取得していた | 書込がない status はロックなしで返す（カード作成とコード再発行のときだけロックを取る）。エラー経路ではロックを取り直さない。画面の0時/境界の再取得は 1.5〜61.5秒に分散 | PublicApi.gs, AdminRpc.gs, app.js |
| ⑦ | 確認コードが「12345-6」と表示され、ハイフンごと入力すると6文字制限で切れてコード不一致になっていた | 表示を「123-456」に変更。入力欄と管理GASの両方で数字以外を除去 | app.js, StaffDialog.html, Admin.gs, AdminRpc.gs |
| ⑧ | 完了済みのカードを照合すると「受付終了」が返っていた | 状態を先に判定し、`ALREADY_COMPLETED` を返す | AdminRpc.gs |
| ⑨ | 6桁コードが衝突すると、完了済み・期限切れのカードに当たることがあった | 照合時は「期限内の達成カード」を優先する | Admin.gs |
| ⑪ | Domain.js が公開側と管理側で乖離していた | 公開版に統一（静的チェックで常時照合） | admin/Domain.js |

## 追加したテスト（`cd 04_tests && npm test`）

- `static_check.cjs`：GAS固有の実行時エラーを静的に検出する。対象は、google.script.run の呼び先（存在するか・プライベートでないか）、未定義の `_` 関数、同名関数の重複、manifest スコープの不足、Advanced Sheets の有効化、共有ファイルの一致、構文。修正前のZIPに対しては①②③と Domain の乖離を検出する。
- `adapter.test.cjs`：GASのモック（グリッド上限つきの Sheets、ScriptLock、Cache、UrlFetch→doPost の署名RPC）を使った結合テスト。修正前は9件中7件が失敗し、修正後は9件すべて合格する。

## 未修正（判断待ちを含む）

- ⑩ Campaigns の pointsJson が1行でも壊れると、公開API全体が止まる。安全停止として残すか、該当行だけ除外するかは判断が必要。
- ⑫ register のレート制限は未実装。
- ⑬ 圧縮された1行コードは整形していない（差分を追いやすくするため、今回は最小修正にとどめた）。
- 平文コードとハッシュの二重保存（運用判断：シートの共有範囲で守るか、平文をやめるか）。
- これらのテストはNode上のモックです。GAS実機、LINE内ブラウザ、同時実行の実測の代わりにはなりません。R05、T01〜T38は従来どおり未実施です。

## 解凍後の最短通し確認（隔離環境）

1. `cd 04_tests && npm test` がすべて合格することを確認する。
2. 管理GASで `initializeV2Database()` を実行し、全シートができたことを確認する。
3. 管理メニュー「開催設定」で今日を含む開催を作成し、AuditLog に CREATE が記録されたことを確認する（署名RPCの疎通確認）。
4. `config.js` に新しい `/exec` を設定して検証用Pagesで開き、登録→抽選→「本日はチャレンジ済み」の表示を確認する。ProcessLog に `DRAW_AND_CARD_COMMIT` が記録されることも確認する。
5. 目標値を小さくした開催で達成させ、「123-456」形式の確認コードをスタッフ確認に入力して完了させる。もう一度照合して「確認済み」になることを確認する。
6. 一時停止→抽選不可→再開、「集計を更新」で Dashboard が書かれることを確認する。
7. グリッド上限の確認：ProcessLog の行数を1000行近くまで増やした状態で抽選が通ることを確認する（④の実機確認）。

## 実機確認で見つかった修正（2026-11-28）

- **抽選直後の画面が書き込み前のカードを表示する。** 通し確認ステップ4で発生。目標1の開催で6の目が出て達成したのに、画面は「6の目！＋3スタンプ」「0/1」「振れる」のままだった。もう一度押すと「達成済み」で拒否され、汎用の通信エラーが表示された（DB は正しく ACHIEVED、二重抽選なし）。原因：抽選結果は Sheets API（`v2AtomicWrite_`）で書くが、返事を作る `v2Status_` は SpreadsheetApp で読み直している。SpreadsheetApp は同じ実行の中で Sheets API の書き込みを反映しないため、書き込み前の行が返っていた。修正：`v2Roll_` が書いたカードを `v2Status_` の引数 `fresh` に渡し、読み直した一覧の該当行を差し替える。公開GASのみの変更。
- テスト：`adapter.test.cjs` の Sheets モックに `__staleReads`（同じ実行の中で SpreadsheetApp の読み取りがキャッシュされ、Sheets API の書き込みが見えない状態）を追加した。回帰テスト1件を追加。修正前は失敗し、修正後は10件すべて合格する。
- 未対応（軽微）：達成済みのカードで「振る」を押したときの理由コードが `NOT_ACHIEVED` になり、画面には汎用の「通信を確認できませんでした」が出る。上の修正でボタンが押せる状態のまま残らなくなるので、通常は発生しない。
