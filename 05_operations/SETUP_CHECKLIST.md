# V2 検証環境 セットアップチェックリスト

上から順に埋める。既存のスプレッドシート・GAS・`daily-dice-challenge` には一切触れない。詳細な背景は `SETUP_AND_DEPLOY.md`。

## 0. GitHub（このリポジトリ）
- [ ] リポジトリ直下に `.github` `01_design`〜`06_handoff` `.gitignore` `README.md` が並んでいる（フォルダごと一段深く入っていない）
- [ ] Settings → Pages → Source を「GitHub Actions」にした
- [ ] Actions の「Test and deploy Pages」が緑（test → deploy の順）
- [ ] 公開URL `https://toaykotobuki-shikahama.github.io/daily-dice-v2/` が開く（この時点では接続先未設定のエラー表示で正常）

## 1. 新規に作るもの（名前に「V2検証」を入れて旧環境と区別する）
| # | 作るもの | 名前の例 | ID / URL を控える |
|---|---|---|---|
| 1 | 管理用スプレッドシート | `V2検証_管理` | |
| 2 | V2 DB スプレッドシート | `V2検証_DB` | `DB_ID` |
| 3 | 簡易テストDB スプレッドシート（実データなし） | `V2検証_簡易テストDB` | `TEST_DB_ID` |
| 4 | 管理GAS（#1 の 拡張機能 → Apps Script） | | |
| 5 | 公開GAS（script.google.com で単独新規作成） | `V2検証_公開` | デプロイ後 `/exec` URL |

- [ ] #2 と #3 のIDが違うことを確認した

## 2. コードを入れる
- [ ] 公開GAS ← `02_gas/public/` の全ファイル（`README.md` `config.example.js` は不要）
- [ ] 管理GAS ← `02_gas/admin/` の全ファイル
- [ ] 両方とも `appsscript.json` を差し替えた（エディタの 設定 →「appsscript.json をエディタで表示」をオン）
- [ ] 両方で サービス → Google Sheets API を追加した

## 3. 秘密鍵を作る（どこにも貼らない・保存しない）
ブラウザのアドレスバー以外の場所で、PCの PowerShell を開いて実行:
```
-join ((1..48) | ForEach-Object { '{0:x2}' -f (Get-Random -Max 256) })
```
96文字の英数字が出る。これを両GASの `ADMIN_RPC_SECRET` に貼ったら、PowerShell は閉じる。

## 4. Script Properties（プロジェクトの設定 → スクリプト プロパティ）
| キー | 公開GAS | 管理GAS |
|---|---|---|
| `DB_ID` | #2 のID | #2 のID（同じ） |
| `ADMIN_RPC_SECRET` | 手順3の値 | 手順3の値（同じ） |
| `PUBLIC_ORIGIN` | `https://toaykotobuki-shikahama.github.io` | — |
| `ADMIN_EMAILS` | — | 管理者のGoogleアカウント（カンマ区切り） |
| `TEST_DB_ID` | — | #3 のID |
| `PUBLIC_EXEC_URL` | — | 手順5で控えた `/exec` URL |

## 5. 初期化とデプロイ
- [ ] 管理GASで `initializeV2Database` を実行 → #2 に全シートがヘッダー付きでできた
- [ ] 公開GAS: デプロイ → 新しいデプロイ → ウェブアプリ（実行: 自分 / アクセス: 全員）→ `/exec` URL を控える
- [ ] 管理GASの `PUBLIC_EXEC_URL` に設定
- [ ] 管理スプシを開き直し、メニューが出る
- [ ] 管理メニュー「スタッフ検証 → テストマスタ初期作成」→ できた検証DBが #2・#3 と別物

## 6. Pages を新GASにつなぐ
- [ ] GitHub 上で `03_pages/config.js` の `REPLACE_WITH_NEW_V2_EXEC_URL` を手順5の `/exec` URL に書き換えてコミット
- [ ] Actions が再び緑になり、公開URLでサイコロ画面が出る

## 7. 通し確認（CHANGELOG_REVIEW2_FIXES.md 末尾の7ステップ）
- [ ] 1〜7 を実施し、結果・日時・端末を記録

## 未決（本番切替までに決める）
- 本番URLの扱い：旧URLから転送するか、QR/LINEのリンクを差し替えるか
- 保存キー：検証中は `daily-dice.identity.v2-verify`。本番で `v1` に戻して第一弾の参加記録を引き継ぐか（戻す場合は `ALLOW_V1_STORAGE_KEY=1` でテストを通す）
