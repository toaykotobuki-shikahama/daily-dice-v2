/** Run once in a NEW, empty V2 spreadsheet. Never point this at the original workbook. */
function initializeV2Database(){v2EnsureSheets_();const ss=v2Db_();ss.setSpreadsheetTimeZone('Asia/Tokyo');return Object.keys(V2_SHEETS);}
