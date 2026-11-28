# 仕様①〜⑩と成果物・検証の対応

| ID | 実装候補 | 対応する検証 | 現状・未達 |
|---|---|---|---|
| ① 開催設定一括管理 | `admin/Admin.gs`, `CampaignSettings.html`, `Campaigns`, `AuditLog` | T05,T06,T10,T11 | UI/入力・版番号・監査の候補。設定＋監査をHMAC署名RPC内で同一batchUpdateする候補。GAS権限・再送・直接編集防止は未立証。 |
| ② JST自動開始終了 | `public/Domain.js`, `PublicApi.gs` | T12,T13,T17 | 純粋な日境界ルールを実装しローカルで一部検証。シートのDate型/旧ISO実測なし。 |
| ③ 対象自動切替 | `resolveCampaign`, `v2Public_` | T07,T14,T16,T25,T35 | 重複拒否・多重対象停止の候補。旧キャッシュ互換を含むGAS統合試験なし。 |
| ④ 開催別カード | `Cards`, identity key | T15,T24 | DB契約候補。既存SERVER_KEY/参加者移行の継続性未確認（R01,R04）。 |
| ⑤ 終了後のスタッフ確認 | `admin/Admin.gs`, `StaffDialog.html` | T21,T22,T23 | 期限内に失効/欠落コードを状態再取得時に再発行、確認完了時にも再検証する候補を実装。端末・GAS接続・応答消失テスト未実施。 |
| ⑥ 開始後の設定保護 | `adminSaveCampaign` | T08,T09 | 開始日/目標/配点の保護候補。R06で未確定の変更判断はエラー停止。 |
| ⑦ 停止/再開 | `adminSetPaused`, public roll gate | T18,T19,T20 | 管理書込を署名RPCで公開GASへ集約する候補を実装。ロック内で最新キャンペーンを再取得。R05/T20の並列検証は未実施。 |
| ⑧ 開催履歴 | `adminListCampaigns` | T34 | 開催全件を一覧表示する候補。履歴タブ・固定集計・詳細分類未完成（R08）。 |
| ⑨ 複製 | `adminDuplicateCampaign` | T11 | 新ID・名称/目標/配点/確認設定だけの入力ドラフト候補。保存再送IDは同一入力の再試行で維持。GAS未実測。 |
| ⑩ 簡易動作確認 | `SimpleTest.gs`, `SimpleTest.html`, 別テストDB | T27–T30,T33 | 専用DB・世代番号・更新列位置を修正。GAS権限/同時要求/本番・詳細DB差分0は未実測。 |

この表の「実装候補」は機能完成・合格を意味しません。全39件のテスト計画結果は `04_tests/TEST_STATUS.md` を参照してください。
