# 新規V2 DB構造案

全シートは新規ブックにだけ作成します。列追加・改名はコードと同じ版で行い、既存ブックへの適用は禁止です。

| シート | 主キー | 主な項目 | 用途 |
|---|---|---|---|
| Campaigns | id | name, startDate, endDate, receptionEndDate, target, pointsJson, confirmationEnabled, paused, archived, version | 開催設定。ID固定、版番号、日程と目標・配点の制約 |
| Participants | participantId | identityHash, secretHash, source, createdAt | 同一ブラウザ参加者の認証・初回流入元 |
| Cards | campaignId + participantId | total, actualTotal, state, todayKey, lastEventId, confirmationHash, confirmationCode, confirmationExpiresAt, achievedAt, completedAt | 開催ごとのカード状態 |
| DailyHistory | eventId | campaignId, participantId, jstDate, face, earned, totalAfter, requestId, createdAt | 1日1回抽選イベント。監査・復元根拠 |
| StaffConfirmLog | operationId | campaignId, participantId, staffEmail, staffName, status, createdAt | 完了記録・再送復元 |
| AuditLog | operationId | actor, campaignId, action, beforeJson, afterJson, version, createdAt | 管理者設定変更の履歴。確認コード・認証情報を格納しない |
| ProcessLog | traceId | action, stage, result, reasonCode, createdAt | 必要最小限の処理調査。秘密値を出さない |
| TestSessions* | sessionId + generation | staffEmail, total, state, timestamps | 簡易テスト専用ブック |
| TestEvents* | eventId | sessionId, generation, face, earned, totalAfter, createdAt | 簡易テスト用の連続抽選履歴 |

`*` は本番相当データと異なる `TEST_DB_ID` に作成します。起動時に `TEST_DB_ID != DB_ID` を検証します。

## 集計設計

第一弾の指標名・計算式を初回の比較基準として維持する方針です。全期間参加カード数は開催ごとの合算対象から外し、開催参加は実抽選ユニーク、アクセス登録は未抽選を含める想定です。翌日率、停止日の分母、2回以上の行数定義、集計固定値の要否はR08が未決のため、集計機能は完成・合格扱いにしていません。
