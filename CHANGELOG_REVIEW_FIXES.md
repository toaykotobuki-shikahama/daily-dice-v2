# レビュー指摘対応差分

- `PublicApi.gs`: lock取得後の最新開催再取得、nextAvailableAt、開催境界、期限切れコード再発行、再送復元、重要処理ログを追加。
- `AdminRpc.gs` / 管理 `Admin.gs`: V2の管理書込をHMAC署名RPCで公開GASに集約。公開GAS内の単一ScriptLockを共有。
- `Analytics.gs`: ダッシュボード更新も同じ公開GAS書込経路に移動。
- `SimpleTest.gs`: セッションDBのtotal/state/updatedAt列位置を修正。
- `TestCore.gs`, `TestApi.gs`, `TestRunner.html`, `TestMaster.gs`, `TestAdmin.gs`, `TestExport.html`: 根拠表に従いE4構文修正版とE5通信間隔修正版を組合せ、V2管理メニューへ統合。
- `app.js`: 次回参加日時表示、開催境界の自動再取得、状態語の統一、エラー確認ID表示。
- `CampaignSettings.html`: 同一内容の再試行で操作IDを維持し、二重開催作成を抑止。
- SETUP/DB/TRACEABILITY/TEST_STATUS/REVIEW/HANDOFF: 単一書込経路、Script Properties、詳細検証統合、未検証範囲を更新。

変更は新規のローカル候補パッケージだけに行いました。既存スプレッドシート、既存GAS、既存GitHub Pagesには触れていません。
