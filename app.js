const DEFAULT_CONFIG = {
  sheetId: "1Rd1KWLNZPIgSFfOnM1sCLjMmGhtRFuIXfHFPYjfg74o",
  gid: "377885389",
  sheetName: "Data",
  range: "A:S",
  timeShiftHours: 0,
  rawTimeShiftHours: -7,
  autoRefreshMs: 5 * 60 * 1000,
  sourceLabel: "Test Pick to Sort / Data",
  staffSource: {
    sheetId: "1AWOeqhCqmBlSfGI5FWJVU4F77lDGNWBUH-TYpJeiYnI",
    gid: "130637853",
    sheetName: "บันทึกเวลาทำงาน",
    range: "B:D",
    sourceLabel: "รายชื่อ Pick and Sort / บันทึกเวลาทำงาน",
  },
};

const config = { ...DEFAULT_CONFIG, ...(window.PICK_SORT_CONFIG || {}) };
let staffLookup = { ...(window.PICK_SORT_STAFF || {}) };
let staffMeta = {
  loaded: false,
  count: Object.keys(staffLookup).length,
  error: "",
};

let records = [];
let sourceMeta = {
  dateMin: "",
  dateMax: "",
  generatedAt: "",
  sourceRows: 0,
  skippedRows: 0,
};
let isLoading = false;

const state = {
  dateFrom: "",
  dateTo: "",
  search: "",
  shiftFilter: "all",
  peopleMode: "pick",
  activeMenu: "overview",
  monthFilter: "",
};

const $ = (selector) => document.querySelector(selector);
const fmt = new Intl.NumberFormat("th-TH", { maximumFractionDigits: 0 });
const fmt1 = new Intl.NumberFormat("th-TH", { maximumFractionDigits: 1 });

const COLUMN_CANDIDATES = {
  pickDetailKey: ["PICKDETAILKEY", "Pick Detail #"],
  item: ["SKU", "Item"],
  qtyEach: ["QTY", "Quantity:", "Qty(ชิ้น)", "Qty ชิ้น", "จำนวนชิ้น", "ชิ้น", "จำนวน", "จำนวน (ชิ้น)", "จำนวน(ชิ้น)"],
  qtyPack: ["UOMQTY", "UOM Qty", "Qty(แพ็ค)", "Qty แพ็ค", "จำนวนแพ็ค", "แพ็ค", "จำนวน (แพ็ค)", "จำนวน(แพ็ค)"],
  wave: ["WAVEKEY", "Wave"],
  pickCode: ["EXT_UDF_STR8", "Pick Detail Text UDF 8"],
  sortCode: ["EXT_UDF_STR9", "Pick Detail Text UDF 9"],
  pickAt: ["EXT_UDF_DATE1", "Pick Detail Date UDF 1"],
  sortAt: ["EXT_UDF_DATE3", "Pick Detail Date UDF 3"],
  pickDate: ["Picked Date", "Pick Date", "วันเดือนปี (Pick)", "วันที่ Pick"],
  pickTime: ["Picked Time", "Pick Time", "เวลา (Pick)", "เวลา Pick"],
  pickSlot: ["Picked Hour", "Picked Slot", "Picked Slot Time", "Slot time (Pick)", "Slot Time Pick"],
  pickShift: ["Picked Shift", "Pick Shift", "Shift (Pick)"],
  sortDate: ["Sort Date", "Sorted Date", "วันเดือนปี (Sort)", "วันที่ Sort"],
  sortTime: ["Sort Time", "Sorted Time", "เวลา(Sort)", "เวลา (Sort)", "เวลา Sort"],
  sortSlot: ["Sort Hour", "Sort Slot", "Sorted Slot", "Slot time (Sort)", "Slot Time Sort"],
  sortShift: ["Sort Shift", "Sorted Shift", "Shift (Sort)"],
  branch: ["Shipto", "สาขา", "Branch", "EXT_UDF_STR10"],
  productCode: ["Product Code", "รหัสสินค้า", "Item Code", "SKU Code"],
  productName: ["Description", "ชื่อสินค้า", "Product Name", "Item Name", "รายละเอียดสินค้า"],
};

const BASE_REQUIRED_FIELDS = ["item", "qtyEach", "qtyPack", "wave", "pickCode", "sortCode"];

const STAFF_COLUMN_CANDIDATES = {
  code: ["รหัสพนักงาน", "รหัสคน Pick and Sort", "รหัสคน", "Employee ID", "Code"],
  name: ["ชื่อ-นามสกุล (ไทย)", "ชื่อคน", "ชื่อ", "Name"],
  nick: ["ชื่อเล่น", "ชื่อเล่นคน", "Nickname", "Nick Name"],
};

const SHIFT_FILTERS = {
  all: "ทั้งหมด",
  day: "DAY รวม OT",
  day_normal: "DAY 07:00-16:00",
  day_ot: "OT DAY 16:30-19:00",
  night: "NIGHT รวม OT",
  night_normal: "NIGHT 19:00-04:00",
  night_ot: "OT NIGHT 04:30-07:00",
  transition: "พัก/เปลี่ยนกะ",
};

const SHIFT_SUMMARY_ROWS = [
  { key: "day_normal", label: "DAY", window: "07:00-16:00", group: "day" },
  { key: "day_ot", label: "OT DAY", window: "16:30-19:00", group: "day" },
  { key: "night_normal", label: "NIGHT", window: "19:00-04:00", group: "night" },
  { key: "night_ot", label: "OT NIGHT", window: "04:30-07:00", group: "night" },
  { key: "transition", label: "พัก/เปลี่ยนกะ", window: "16:00-16:30 / 04:00-04:30", group: "transition" },
];

const msCache = new Map();

function gvizUrl(callbackName, source = config) {
  const params = new URLSearchParams({
    sheet: source.sheetName,
    gid: String(source.gid || ""),
    tqx: `out:json;responseHandler:${callbackName}`,
    headers: "0",
    _: String(Date.now()),
  });
  if (source.range) {
    params.set("range", source.range);
    if (source.range.startsWith("A:")) {
      params.set("tq", "where A is not null");
    }
  }
  return `https://docs.google.com/spreadsheets/d/${source.sheetId}/gviz/tq?${params.toString()}`;
}

function loadSheetViaJsonp(source = config, timeoutMs = 20000) {
  return new Promise((resolve, reject) => {
    const callbackName = `__pickToSort_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    const script = document.createElement("script");
    let done = false;
    const timeoutId = window.setTimeout(() => {
      cleanup();
      reject(new Error("โหลดข้อมูลจาก Google Sheet ไม่สำเร็จในเวลาที่กำหนด"));
    }, timeoutMs);

    function cleanup() {
      if (done) return;
      done = true;
      window.clearTimeout(timeoutId);
      delete window[callbackName];
      script.remove();
    }

    window[callbackName] = (payload) => {
      cleanup();
      if (!payload || payload.status !== "ok") {
        reject(new Error(payload?.errors?.[0]?.detailed_message || "Google Sheet ส่งข้อมูลกลับมาไม่สมบูรณ์"));
        return;
      }
      resolve(payload);
    };

    script.onerror = () => {
      cleanup();
      reject(new Error(`เปิด ${source.sourceLabel || "Google Sheet source"} ไม่ได้ ตรวจสอบสิทธิ์การแชร์หรืออินเทอร์เน็ต`));
    };
    script.async = true;
    script.src = gvizUrl(callbackName, source);
    document.head.appendChild(script);
  });
}

function cellText(cell) {
  if (!cell) return "";
  // Prefer raw values so visual number formats in Sheets do not break qty parsing.
  if (cell.v !== undefined && cell.v !== null) {
    const raw = String(cell.v).trim();
    if (raw) return raw;
  }
  if (cell.f !== undefined && cell.f !== null) return String(cell.f).trim();
  return "";
}

function rowsFromGviz(payload) {
  const cols = payload.table?.cols || [];
  const rows = payload.table?.rows || [];
  const values = rows.map((row) => cols.map((_, index) => cellText(row.c?.[index])));
  const labels = cols.map((column) => cellText({ f: column.label || column.id || "" }));
  return labels.some(Boolean) ? [labels, ...values] : values;
}

function normalizeHeader(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[()\[\]]/g, " ")
    .replace(/\s+/g, " ")
    .replace(/[:：]/g, "");
}

function headerScore(headers) {
  const columnMap = buildColumnMap(headers, []);
  return BASE_REQUIRED_FIELDS.filter((key) => columnIndex(columnMap, COLUMN_CANDIDATES[key]) >= 0).length;
}

function resolveRecordTable(rawRows) {
  const scanLimit = Math.min(rawRows.length, 30);
  let headerIndex = -1;
  let bestScore = 0;

  for (let index = 0; index < scanLimit; index += 1) {
    const score = headerScore(rawRows[index] || []);
    if (score > bestScore) {
      bestScore = score;
      headerIndex = index;
    }
  }

  if (headerIndex < 0 || bestScore < 4) {
    throw new Error("ไม่พบ header ของตาราง Data");
  }

  const nextRow = rawRows[headerIndex + 1] || [];
  const nextScore = headerScore(nextRow);
  const hasTwoHeaderRows = nextScore >= 4;
  return {
    technicalHeaders: rawRows[headerIndex] || [],
    displayHeaders: hasTwoHeaderRows ? nextRow : rawRows[headerIndex] || [],
    dataRows: rawRows.slice(headerIndex + (hasTwoHeaderRows ? 2 : 1)),
    firstDataRowNumber: headerIndex + (hasTwoHeaderRows ? 3 : 2),
  };
}

function missingRequiredFields(indexes) {
  const missing = BASE_REQUIRED_FIELDS.filter((key) => indexes[key] < 0);
  const hasPickDateTime = indexes.pickDate >= 0 && indexes.pickTime >= 0;
  const hasSortDateTime = indexes.sortDate >= 0 && indexes.sortTime >= 0;
  if (indexes.pickAt < 0 && !hasPickDateTime) missing.push("pickDate/pickTime");
  if (indexes.sortAt < 0 && !hasSortDateTime) missing.push("sortDate/sortTime");
  return missing;
}

function buildColumnMap(technicalHeaders, displayHeaders) {
  const map = new Map();
  [technicalHeaders, displayHeaders].forEach((headers) => {
    headers.forEach((header, index) => {
      const key = normalizeHeader(header);
      if (key && !map.has(key)) map.set(key, index);
    });
  });
  return map;
}

function columnIndex(columnMap, candidates) {
  for (const candidate of candidates) {
    const key = normalizeHeader(candidate);
    if (columnMap.has(key)) return columnMap.get(key);
  }
  return -1;
}

function normalizeCode(value) {
  let code = String(value || "").trim();
  if (/^\d+\.0$/.test(code)) code = code.slice(0, -2);
  return code.startsWith("MPPTG") ? code.toUpperCase() : code;
}

function normalizeDigits(value) {
  const thaiNumerals = {
    "๐": "0",
    "๑": "1",
    "๒": "2",
    "๓": "3",
    "๔": "4",
    "๕": "5",
    "๖": "6",
    "๗": "7",
    "๘": "8",
    "๙": "9",
  };
  return String(value ?? "")
    .replace(/[๐-๙]/g, (char) => thaiNumerals[char])
    .replace(/[\u00a0\u202f]/g, " ")
    .replace(/[−–—]/g, "-");
}

function normalizeNumberToken(token) {
  let text = normalizeDigits(token)
    .replace(/[()_\s'’]/g, "")
    .replace(/-/g, "");
  const lastComma = text.lastIndexOf(",");
  const lastDot = text.lastIndexOf(".");

  if (lastComma >= 0 && lastDot >= 0) {
    const decimalSeparator = lastComma > lastDot ? "," : ".";
    const thousandSeparator = decimalSeparator === "," ? "." : ",";
    text = text.replace(new RegExp(`\\${thousandSeparator}`, "g"), "");
    if (decimalSeparator === ",") text = text.replace(",", ".");
    return text;
  }

  if (lastComma >= 0) {
    const parts = text.split(",");
    const lastPart = parts[parts.length - 1] || "";
    const looksLikeThousands = parts.length > 2 || (lastPart.length === 3 && parts[0].length <= 3);
    return looksLikeThousands ? parts.join("") : parts.join(".");
  }

  if (lastDot >= 0) {
    const parts = text.split(".");
    const groupedThousands = parts.length > 2 && parts.slice(1).every((part) => part.length === 3);
    return groupedThousands ? parts.join("") : text;
  }

  return text;
}

function number(value) {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  const text = normalizeDigits(value).trim();
  if (!text) return 0;

  const numericText = text.replace(/[^\d,.\-()\s'_’]/g, "|");
  const match = numericText.match(/\(?\s*-?\s*\d+(?:[\s,._'’]\d+)*(?:[,.]\d+)?\s*\)?/);
  if (!match) return 0;

  const token = match[0];
  const isNegative = token.includes("-") || /^\s*\(.*\)\s*$/.test(token);
  const normalized = normalizeNumberToken(token);
  const parsed = Number(normalized);
  if (!Number.isFinite(parsed)) return 0;
  return isNegative ? -parsed : parsed;
}

function cleanValue(value) {
  const text = String(value ?? "").trim();
  if (!text) return "";
  if (/^(not\s*(picked|sorted|pick|sort)|n\/a|na|null|-+)$/i.test(text)) return "";
  return text;
}

function isNotPickedStatus(value) {
  return /^not\s*(picked|pick)$/i.test(String(value ?? "").trim());
}

function parseDateTime(value, { shiftHours = config.rawTimeShiftHours ?? config.timeShiftHours ?? 0 } = {}) {
  const text = cleanValue(value);
  if (!text) return null;

  const thaiMatch = text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})\s+(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
  if (thaiMatch) {
    const [, d, m, y, hh, mm, ss = "0"] = thaiMatch;
    const dt = new Date(Number(y), Number(m) - 1, Number(d), Number(hh), Number(mm), Number(ss));
    dt.setHours(dt.getHours() + shiftHours);
    return dt;
  }

  const gvizMatch = text.match(/^Date\((\d+),(\d+),(\d+),(\d+),(\d+)(?:,(\d+))?\)$/);
  if (gvizMatch) {
    const [, y, monthZero, d, hh, mm, ss = "0"] = gvizMatch;
    const dt = new Date(Number(y), Number(monthZero), Number(d), Number(hh), Number(mm), Number(ss));
    dt.setHours(dt.getHours() + shiftHours);
    return dt;
  }

  const dt = new Date(text);
  if (Number.isNaN(dt.getTime())) return null;
  dt.setHours(dt.getHours() + shiftHours);
  return dt;
}

function pad2(value) {
  return String(value).padStart(2, "0");
}

function parseDateOnly(value) {
  const text = cleanValue(value);
  if (!text) return "";

  const thaiMatch = text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (thaiMatch) {
    const [, d, m, y] = thaiMatch;
    return `${y}-${pad2(m)}-${pad2(d)}`;
  }

  const isoMatch = text.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (isoMatch) {
    const [, y, m, d] = isoMatch;
    return `${y}-${pad2(m)}-${pad2(d)}`;
  }

  const gvizMatch = text.match(/^Date\((\d+),(\d+),(\d+)(?:,\d+,\d+(?:,\d+)?)?\)$/);
  if (gvizMatch) {
    const [, y, monthZero, d] = gvizMatch;
    return `${y}-${pad2(Number(monthZero) + 1)}-${pad2(d)}`;
  }

  const dateTime = parseDateTime(text, { shiftHours: 0 });
  return dateTime ? dateParts(dateTime).date : "";
}

function parseTimeOnly(value) {
  const text = cleanValue(value);
  if (!text) return "";

  const timeMatch = text.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
  if (timeMatch) {
    const [, hh, mm] = timeMatch;
    return `${pad2(hh)}:${mm}`;
  }

  const gvizMatch = text.match(/^Date\(\d+,\d+,\d+,(\d+),(\d+)(?:,\d+)?\)$/);
  if (gvizMatch) {
    const [, hh, mm] = gvizMatch;
    return `${pad2(hh)}:${pad2(mm)}`;
  }

  const dateTime = parseDateTime(text, { shiftHours: 0 });
  return dateTime ? dateParts(dateTime).time : "";
}

function slotInfo(slotValue, timeValue) {
  const slot = cleanValue(slotValue);
  const time = cleanValue(timeValue);
  const slotMatch = slot.match(/(\d{1,2})\s*:\s*\d{2}/);
  if (slotMatch) return { slot, slotKey: pad2(slotMatch[1]) };
  if (time) return { slot: `${time.slice(0, 2)}:00-${time.slice(0, 2)}:59`, slotKey: time.slice(0, 2) };
  return { slot: "", slotKey: "" };
}

function dateParts(dt) {
  if (!dt) return { at: "", date: "", time: "", slot: "", slotKey: "" };
  const year = dt.getFullYear();
  const month = pad2(dt.getMonth() + 1);
  const day = pad2(dt.getDate());
  const hour = pad2(dt.getHours());
  const minute = pad2(dt.getMinutes());
  const second = pad2(dt.getSeconds());
  return {
    at: `${year}-${month}-${day}T${hour}:${minute}:${second}`,
    date: `${year}-${month}-${day}`,
    time: `${hour}:${minute}`,
    slot: `${hour}:00-${hour}:59`,
    slotKey: hour,
  };
}

function workTimeFromDateTimeFields(dateValue, timeValue, slotValue) {
  const date = parseDateOnly(dateValue);
  const time = parseTimeOnly(timeValue);
  const slot = slotInfo(slotValue, time);
  return {
    at: date && time ? `${date}T${time}:00` : "",
    date,
    time,
    slot: slot.slot,
    slotKey: slot.slotKey,
  };
}

function workTimeFromRawTimestamp(value) {
  return dateParts(parseDateTime(value, { shiftHours: config.rawTimeShiftHours ?? config.timeShiftHours ?? 0 }));
}

function resolveWorkTime(source, kind) {
  const dateTimeFields = workTimeFromDateTimeFields(source[`${kind}Date`], source[`${kind}Time`], source[`${kind}Slot`]);
  if (dateTimeFields.at || dateTimeFields.date || dateTimeFields.time) return dateTimeFields;
  return workTimeFromRawTimestamp(source[`${kind}At`]);
}

function previousDate(dateText) {
  if (!dateText) return "";
  const [year, month, day] = dateText.split("-").map(Number);
  const dt = new Date(year, month - 1, day);
  dt.setDate(dt.getDate() - 1);
  return `${dt.getFullYear()}-${pad2(dt.getMonth() + 1)}-${pad2(dt.getDate())}`;
}

function shiftInfo(workTime, sourceShift = "") {
  if (!workTime || !workTime.at) {
    const shiftText = normalizeHeader(sourceShift);
    if (shiftText.includes("day")) {
      return {
        key: "day_normal",
        group: "day",
        label: "DAY",
        shortLabel: "DAY",
        window: "-",
        date: workTime?.date || "",
        isOt: false,
      };
    }
    if (shiftText.includes("night")) {
      return {
        key: "night_normal",
        group: "night",
        label: "NIGHT",
        shortLabel: "NIGHT",
        window: "-",
        date: workTime?.date || "",
        isOt: false,
      };
    }
    return {
      key: "unknown",
      group: "unknown",
      label: "ไม่ระบุกะ",
      shortLabel: "-",
      window: "-",
      date: "",
      isOt: false,
    };
  }

  const hour = Number(workTime.at.slice(11, 13));
  const minute = Number(workTime.at.slice(14, 16));
  const total = hour * 60 + minute;
  const date = workTime.date;

  if (total >= 420 && total <= 960) {
    return { key: "day_normal", group: "day", label: "DAY", shortLabel: "DAY", window: "07:00-16:00", date, isOt: false };
  }
  if (total >= 990 && total < 1140) {
    return { key: "day_ot", group: "day", label: "OT DAY", shortLabel: "OT DAY", window: "16:30-19:00", date, isOt: true };
  }
  if (total >= 1140 || total <= 240) {
    return {
      key: "night_normal",
      group: "night",
      label: "NIGHT",
      shortLabel: "NIGHT",
      window: "19:00-04:00",
      date: total <= 240 ? previousDate(date) : date,
      isOt: false,
    };
  }
  if (total >= 270 && total < 420) {
    return { key: "night_ot", group: "night", label: "OT NIGHT", shortLabel: "OT NIGHT", window: "04:30-07:00", date: previousDate(date), isOt: true };
  }

  const isMorningTransition = total > 240 && total < 270;
  return {
    key: "transition",
    group: "transition",
    label: "พัก/เปลี่ยนกะ",
    shortLabel: "พัก",
    window: isMorningTransition ? "04:00-04:30" : "16:00-16:30",
    date: isMorningTransition ? previousDate(date) : date,
    isOt: false,
  };
}

function workerInfo(codeValue) {
  const code = normalizeCode(codeValue);
  const info = staffLookup[code] || {};
  return {
    code,
    name: info.name || "",
    nick: info.nick || "",
    role: info.role || "",
    zone: info.zone || "",
    team: info.team || "",
  };
}

function staffHeaderInfo(headers) {
  const columnMap = buildColumnMap(headers, []);
  const code = columnIndex(columnMap, STAFF_COLUMN_CANDIDATES.code);
  const name = columnIndex(columnMap, STAFF_COLUMN_CANDIDATES.name);
  const nick = columnIndex(columnMap, STAFF_COLUMN_CANDIDATES.nick);
  return { code, name, nick, ok: code >= 0 && (name >= 0 || nick >= 0) };
}

function buildStaffLookup(rawRows) {
  const scanLimit = Math.min(rawRows.length, 100);
  let headerIndex = -1;
  let indexes = null;

  for (let index = 0; index < scanLimit; index += 1) {
    const info = staffHeaderInfo(rawRows[index] || []);
    if (info.ok) {
      headerIndex = index;
      indexes = info;
      break;
    }
  }

  if (headerIndex < 0 || !indexes) {
    throw new Error("ไม่พบ header รายชื่อพนักงาน");
  }

  const lookup = {};
  rawRows.slice(headerIndex + 1).forEach((row) => {
    const code = normalizeCode(cleanValue(row[indexes.code]));
    if (!code || normalizeHeader(code) === "รหัสพนักงาน") return;
    const name = indexes.name >= 0 ? cleanValue(row[indexes.name]) : "";
    const nick = indexes.nick >= 0 ? cleanValue(row[indexes.nick]) : "";
    if (!name && !nick) return;
    lookup[code] = { name, nick };
  });
  return lookup;
}

async function loadStaffLookup() {
  const source = config.staffSource;
  if (!source?.sheetId || !source.sheetName) {
    return { lookup: staffLookup, count: Object.keys(staffLookup).length };
  }
  try {
    // Attempt load with a short 4-second timeout.
    // If it's private or redirected to Google Login, fail fast.
    const payload = await loadSheetViaJsonp(source, 4000);
    const lookup = buildStaffLookup(rowsFromGviz(payload));
    return { lookup, count: Object.keys(lookup).length };
  } catch (error) {
    const fallbackCount = Object.keys(staffLookup).length;
    return {
      lookup: staffLookup,
      count: fallbackCount,
      error: error.message || "โหลดรายชื่อไม่สำเร็จ",
      fallback: fallbackCount > 0,
    };
  }
}

function normalizeRecords(rawRows) {
  if (rawRows.length < 2) return { records: [], skippedRows: 0 };

  const table = resolveRecordTable(rawRows);
  const { technicalHeaders, displayHeaders, dataRows, firstDataRowNumber } = table;
  const columnMap = buildColumnMap(technicalHeaders, displayHeaders);
  const indexes = Object.fromEntries(
    Object.entries(COLUMN_CANDIDATES).map(([key, candidates]) => [key, columnIndex(columnMap, candidates)])
  );
  const missing = missingRequiredFields(indexes);

  // Fallback: fixed Data columns keep quantities usable even when Google hides text headers in numeric columns.
  if (indexes.qtyEach < 0 && technicalHeaders.length >= 2) {
    indexes.qtyEach = 1; // Column B
  }
  if (indexes.qtyPack < 0 && technicalHeaders.length >= 3) {
    indexes.qtyPack = 2; // Column C
  }
  if ((indexes.pickShift < 0 && indexes.sortShift < 0) && technicalHeaders.length >= 12) {
    indexes.pickShift = 11; // Column L
    // leave sortShift as -1; shiftInfo will use pickShift by default
  }
  if (indexes.productCode < 0 && technicalHeaders.length >= 18) {
    indexes.productCode = 17; // Column R
  }
  if (indexes.productName < 0 && technicalHeaders.length >= 19) {
    indexes.productName = 18; // Column S
  }

  const missingAfterFallback = missingRequiredFields(indexes);
  if (missingAfterFallback.length) {
    throw new Error(`ไม่พบ column ที่ต้องใช้: ${missingAfterFallback.join(", ")}`);
  }

  let skippedRows = 0;
  const normalized = [];
  dataRows.forEach((row, rowIndex) => {
    const rawCell = (key) => (indexes[key] >= 0 ? String(row[indexes[key]] ?? "").trim() : "");
    const rawValue = (key) => cleanValue(rawCell(key));
    const source = {
      pickDetailKey: rawValue("pickDetailKey"),
      qtyEach: rawValue("qtyEach"),
      item: rawValue("item"),
      qtyPack: rawValue("qtyPack"),
      wave: rawValue("wave"),
      pickCode: rawValue("pickCode"),
      sortCode: rawValue("sortCode"),
      pickAt: rawValue("pickAt"),
      sortAt: rawValue("sortAt"),
      pickDate: rawValue("pickDate"),
      pickTime: rawValue("pickTime"),
      pickSlot: rawValue("pickSlot"),
      pickShift: rawValue("pickShift"),
      sortDate: rawValue("sortDate"),
      sortTime: rawValue("sortTime"),
      sortSlot: rawValue("sortSlot"),
      sortShift: rawValue("sortShift"),
      branch: rawValue("branch"),
      productCode: rawValue("productCode"),
      productName: rawValue("productName"),
    };
    const pick = resolveWorkTime(source, "pick");
    const sort = resolveWorkTime(source, "sort");
    const pickShift = shiftInfo(pick, source.pickShift);
    const sortShift = shiftInfo(sort, source.sortShift);
    const shift = pick.at ? pickShift : sortShift;
    const rawQtyEach = number(row[indexes.qtyEach]);
    const rawQtyPack = number(row[indexes.qtyPack]);
    const shouldCountQty = !isNotPickedStatus(rawCell("pickShift"));
    const wave = source.wave;
    const item = source.item;
    const productCode = source.productCode || item;
    const productName = source.productName;
    const picker = workerInfo(source.pickCode);
    const sorter = workerInfo(source.sortCode);

    if (!wave && !item && !picker.code && !sorter.code && !pick.at && !sort.at) {
      skippedRows += 1;
      return;
    }

    const pickMs = toMs(pick.at);
    const sortMs = toMs(sort.at);
    const cycleMinutes = pickMs && sortMs && sortMs >= pickMs ? Math.round(((sortMs - pickMs) / 60000) * 100) / 100 : null;
    normalized.push({
      row: firstDataRowNumber + rowIndex,
      item,
      productCode,
      productName,
      rawQtyEach,
      rawQtyPack,
      qtyEach: shouldCountQty ? rawQtyEach : 0,
      qtyPack: shouldCountQty ? rawQtyPack : 0,
      countedQty: shouldCountQty,
      wave,
      picker,
      sorter,
      pick,
      sort,
      pickShift,
      sortShift,
      shift,
      source,
      cycleMinutes,
      branch: source.branch,
    });
  });

  return { records: normalized, skippedRows };
}

function deriveMeta(rows, skippedRows) {
  const dates = [...new Set(rows.flatMap((row) => [rowDate(row, "pick"), rowDate(row, "sort")]).filter(Boolean))].sort();
  
  let maxPickAt = "";
  let maxSortAt = "";
  rows.forEach((row) => {
    if (row.pick?.at && row.pick.at > maxPickAt) {
      maxPickAt = row.pick.at;
    }
    if (row.sort?.at && row.sort.at > maxSortAt) {
      maxSortAt = row.sort.at;
    }
  });

  return {
    dateMin: dates[0] || "",
    dateMax: dates[dates.length - 1] || "",
    generatedAt: formatThaiDateTime(new Date()),
    sourceRows: rows.length,
    skippedRows,
    latestPickAt: maxPickAt,
    latestSortAt: maxSortAt,
  };
}

function setStatus(text, tone = "") {
  const status = $("#loadStatus");
  if (!text) {
    status.style.display = "none";
    return;
  }
  status.style.display = "";
  status.textContent = text;
  status.className = tone ? `status-${tone}` : "";
}

function setLoading(isBusy) {
  isLoading = isBusy;
  $("#refreshBtn").disabled = isBusy;
  $("#exportBtn").disabled = isBusy || !records.length;
}

function toMs(value) {
  if (!value) return null;
  let cached = msCache.get(value);
  if (cached === undefined) {
    cached = new Date(value).getTime();
    msCache.set(value, cached);
  }
  return cached;
}

function minutesBetween(a, b) {
  const start = toMs(a);
  const end = toMs(b);
  if (!start || !end || end < start) return null;
  return (end - start) / 60000;
}

function metricMinutes(value) {
  if (value === null || value === undefined || Number.isNaN(value)) return "-";
  if (value < 60) return `${fmt1.format(value)} นาที`;
  return `${fmt1.format(value / 60)} ชม.`;
}

function activeMode(mode = state.peopleMode) {
  return mode === "sort" ? "sort" : "pick";
}

function roleLabel(mode = state.peopleMode) {
  return activeMode(mode) === "sort" ? "Sort" : "Pick";
}

function roleTime(record, mode = state.peopleMode) {
  return activeMode(mode) === "sort" ? record.sort : record.pick;
}

function roleWorker(record, mode = state.peopleMode) {
  return activeMode(mode) === "sort" ? record.sorter : record.picker;
}

function roleShift(record, mode = state.peopleMode) {
  if (activeMode(mode) === "sort") return record.sortShift;
  return record.pickShift;
}

function filterShift(record, mode = state.peopleMode) {
  return roleShift(record, mode);
}

function filterDate(record, mode = state.peopleMode) {
  return workDate(record);
}

function rowDate(record, mode = state.peopleMode) {
  return workDate(record);
}

function workDate(record) {
  if (record.pickShift?.date) return record.pickShift.date;
  if (record.pick?.date) return record.pick.date;
  if (record.sortShift?.date) return record.sortShift.date;
  return record.sort?.date || "";
}

function formatThaiDateTimeStr(isoStr) {
  if (!isoStr) return "-";
  const parts = isoStr.split("T");
  if (parts.length < 2) return "-";
  const dateParts = parts[0].split("-");
  const timeParts = parts[1].split(":");
  if (dateParts.length < 3 || timeParts.length < 2) return "-";
  return `${dateParts[2]}/${dateParts[1]}/${dateParts[0]} ${timeParts[0]}:${timeParts[1]}`;
}

function formatThaiDateTime(dt) {
  if (!dt) return "-";
  const d = String(dt.getDate()).padStart(2, "0");
  const m = String(dt.getMonth() + 1).padStart(2, "0");
  const y = dt.getFullYear();
  const hh = String(dt.getHours()).padStart(2, "0");
  const mm = String(dt.getMinutes()).padStart(2, "0");
  return `${d}/${m}/${y} ${hh}:${mm}`;
}

function getLocalDateString(date = new Date()) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function html(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function displayWorker(worker) {
  if (!worker || !worker.code) return "-";
  const label = workerDisplayName(worker);
  return `${html(label)} (${html(worker.code)})`;
}

function workerDisplayName(worker) {
  if (!worker) return "-";
  return worker.name || worker.nick || worker.code || "-";
}

function searchText(record, mode = state.peopleMode) {
  const worker = roleWorker(record, mode);
  const shift = roleShift(record, mode);
  return [
    record.wave,
    record.item,
    record.productCode,
    record.productName,
    worker.code,
    worker.nick,
    worker.name,
    shift?.label,
    shift?.window,
    shift?.date,
    record.branch,
  ]
    .join(" ")
    .toLowerCase();
}

function shiftMatches(record, filterValue) {
  const shift = filterShift(record);
  if (!filterValue || filterValue === "all") return true;
  if (filterValue === "day" || filterValue === "night") return shift?.group === filterValue;
  if (filterValue === "transition") return shift?.group === "transition";
  return shift?.key === filterValue;
}

function filteredRecords({ ignoreShift = false } = {}) {
  const term = state.search.trim().toLowerCase();
  return records.filter((record) => {
    const date = filterDate(record);
    if ((state.dateFrom || state.dateTo) && !date) return false;
    if (state.dateFrom && date && date < state.dateFrom) return false;
    if (state.dateTo && date && date > state.dateTo) return false;
    if (term && !searchText(record).includes(term)) return false;
    if (!ignoreShift && !shiftMatches(record, state.shiftFilter)) return false;
    return true;
  });
}

function mean(values) {
  const clean = values
    .map((value) => Number(value))
    .filter((value) => Number.isFinite(value) && value > 0);
  if (!clean.length) return null;
  return clean.reduce((sum, value) => sum + value, 0) / clean.length;
}

function percentile(values, p) {
  const clean = values
    .filter((value) => value !== null && value !== undefined && !Number.isNaN(value))
    .sort((a, b) => a - b);
  if (!clean.length) return null;
  const index = Math.min(clean.length - 1, Math.max(0, Math.ceil((p / 100) * clean.length) - 1));
  return clean[index];
}

function sumBy(rows, key) {
  return rows.reduce((sum, row) => sum + (Number(row[key]) || 0), 0);
}

function uniqueCount(rows, getter) {
  return new Set(rows.map(getter).filter(Boolean)).size;
}

function groupBy(rows, getter) {
  const map = new Map();
  rows.forEach((row) => {
    const key = getter(row);
    if (!key) return;
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(row);
  });
  return map;
}

function calculateAvgStaffProductivity(rows) {
  const workerCodes = new Set([
    ...rows.map(r => r.picker.code),
    ...rows.map(r => r.sorter.code)
  ].filter(Boolean));
  
  let totalWorkers = 0;
  let sumRatesPack = 0;
  
  workerCodes.forEach(code => {
    const pickerRows = rows.filter(r => r.picker.code === code && r.pick.at);
    const sorterRows = rows.filter(r => r.sorter.code === code && r.sort.at);
    
    const days = new Set([
      ...pickerRows.map(rowDate),
      ...sorterRows.map(rowDate)
    ].filter(Boolean));
    
    let activeMinutes = 0;
    
    days.forEach(day => {
      const times = [];
      pickerRows.forEach(r => {
        if (rowDate(r) === day && r.pick.at) {
          const t = toMs(r.pick.at);
          if (t) times.push(t);
        }
      });
      sorterRows.forEach(r => {
        if (rowDate(r) === day && r.sort.at) {
          const t = toMs(r.sort.at);
          if (t) times.push(t);
        }
      });
      
      if (!times.length) return;
      const span = (Math.max(...times) - Math.min(...times)) / 60000;
      const recordCount = pickerRows.filter(r => rowDate(r) === day).length + 
                          sorterRows.filter(r => rowDate(r) === day).length;
      activeMinutes += Math.max(span, recordCount > 1 ? 10 : 5);
    });
    
    const activeHours = activeMinutes / 60;
    if (activeHours > 0) {
      const qtyPack = sumBy(pickerRows, "qtyPack") + sumBy(sorterRows, "qtyPack");
      sumRatesPack += qtyPack / activeHours;
      totalWorkers += 1;
    }
  });
  
  return {
    avgPack: totalWorkers > 0 ? sumRatesPack / totalWorkers : 0,
    totalWorkers,
  };
}

function calculateTotalProductivity(rows) {
  const workerCodes = new Set([
    ...rows.map(r => r.picker.code),
    ...rows.map(r => r.sorter.code)
  ].filter(Boolean));
  
  let totalActiveMinutes = 0;
  
  workerCodes.forEach(code => {
    const pickerRows = rows.filter(r => r.picker.code === code && r.pick.at);
    const sorterRows = rows.filter(r => r.sorter.code === code && r.sort.at);
    
    const days = new Set([
      ...pickerRows.map(rowDate),
      ...sorterRows.map(rowDate)
    ].filter(Boolean));
    
    days.forEach(day => {
      const times = [];
      pickerRows.forEach(r => {
        if (rowDate(r) === day && r.pick.at) {
          const t = toMs(r.pick.at);
          if (t) times.push(t);
        }
      });
      sorterRows.forEach(r => {
        if (rowDate(r) === day && r.sort.at) {
          const t = toMs(r.sort.at);
          if (t) times.push(t);
        }
      });
      
      if (!times.length) return;
      const span = (Math.max(...times) - Math.min(...times)) / 60000;
      const recordCount = pickerRows.filter(r => rowDate(r) === day).length + 
                          sorterRows.filter(r => rowDate(r) === day).length;
      totalActiveMinutes += Math.max(span, recordCount > 1 ? 10 : 5);
    });
  });
  
  const totalActiveHours = totalActiveMinutes / 60;
  const totalQtyPack = sumBy(rows, "qtyPack");
  const productivity = totalActiveHours > 0 ? totalQtyPack / totalActiveHours : 0;
  
  return {
    productivity,
    totalActiveHours,
    totalQtyPack,
    totalQtyEach: sumBy(rows, "qtyEach"),
  };
}

function calculateProductivityByShift(rows, shiftGroup) {
  const filteredRows = rows.filter(row => row.shift?.group === shiftGroup);
  if (!filteredRows.length) return { productivity: 0, totalActiveHours: 0, totalQtyPack: 0, totalQtyEach: 0 };
  
  const workerCodes = new Set([
    ...filteredRows.map(r => r.picker.code),
    ...filteredRows.map(r => r.sorter.code)
  ].filter(Boolean));
  
  let totalActiveMinutes = 0;
  
  workerCodes.forEach(code => {
    const pickerRows = filteredRows.filter(r => r.picker.code === code && r.pick.at);
    const sorterRows = filteredRows.filter(r => r.sorter.code === code && r.sort.at);
    
    const days = new Set([
      ...pickerRows.map(rowDate),
      ...sorterRows.map(rowDate)
    ].filter(Boolean));
    
    days.forEach(day => {
      const times = [];
      pickerRows.forEach(r => {
        if (rowDate(r) === day && r.pick.at) {
          const t = toMs(r.pick.at);
          if (t) times.push(t);
        }
      });
      sorterRows.forEach(r => {
        if (rowDate(r) === day && r.sort.at) {
          const t = toMs(r.sort.at);
          if (t) times.push(t);
        }
      });
      
      if (!times.length) return;
      const span = (Math.max(...times) - Math.min(...times)) / 60000;
      const recordCount = pickerRows.filter(r => rowDate(r) === day).length + 
                          sorterRows.filter(r => rowDate(r) === day).length;
      totalActiveMinutes += Math.max(span, recordCount > 1 ? 10 : 5);
    });
  });
  
  const totalActiveHours = totalActiveMinutes / 60;
  const totalQtyPack = sumBy(filteredRows, "qtyPack");
  const productivity = totalActiveHours > 0 ? totalQtyPack / totalActiveHours : 0;
  
  return {
    productivity,
    totalActiveHours,
    totalQtyPack,
    totalQtyEach: sumBy(filteredRows, "qtyEach"),
  };
}

function renderKpis(rows, prevRows = []) {
  const mode = activeMode();
  const label = roleLabel(mode);
  const roleRows = rowsForRole(rows, mode);
  const prevRoleRows = rowsForRole(prevRows, mode);
  const qtyRows = roleRows;
  const prevQtyRows = prevRoleRows;
  const cycles = rows.map((row) => row.cycleMinutes).filter((value) => value !== null);
  const sorted = rows.filter((row) => row.sort.at).length;
  const avgCycle = mean(cycles);
  const items = uniqueCount(qtyRows, (row) => row.item);
  const waveCount = uniqueCount(qtyRows, (row) => row.wave);
  const sortedRate = roleRows.length ? (sorted / roleRows.length) * 100 : 0;

  const totalQtyEach = sumBy(qtyRows, "qtyEach");
  const totalQtyPack = sumBy(qtyRows, "qtyPack");
  const notCountedRows = rows.filter((row) => row.countedQty === false);
  const notCountedQtyEach = sumBy(notCountedRows, "rawQtyEach");
  const notCountedQtyPack = sumBy(notCountedRows, "rawQtyPack");
  const totalProd = calculateRoleProductivity(rows, mode);
  const workerCount = uniqueCount(roleRows, (row) => roleWorker(row, mode).code);

  // branch counts (total / day / night)
  const branchAll  = new Set(qtyRows.map(r => r.branch).filter(Boolean));
  const branchDay  = new Set(qtyRows.filter(r => roleShift(r, mode)?.group === "day").map(r => r.branch).filter(Boolean));
  const branchNight = new Set(qtyRows.filter(r => roleShift(r, mode)?.group === "night").map(r => r.branch).filter(Boolean));
  const branchTotal = branchAll.size;
  const branchDayCount = branchDay.size;
  const branchNightCount = branchNight.size;

  // previous period metrics
  const hasPrev = prevRows.length > 0;
  const pCycles = prevRows.map((r) => r.cycleMinutes).filter((v) => v !== null);
  const pSorted = prevRoleRows.filter((r) => r.sort.at).length;
  const pTotalQtyEach  = hasPrev ? sumBy(prevQtyRows, "qtyEach") : null;
  const pTotalQtyPack  = hasPrev ? sumBy(prevQtyRows, "qtyPack") : null;
  const pSortedRate    = hasPrev && prevRoleRows.length ? (pSorted / prevRoleRows.length) * 100 : null;
  const pAvgCycle      = hasPrev ? mean(pCycles) : null;
  const pWorkers       = hasPrev ? uniqueCount(prevRoleRows, (r) => roleWorker(r, mode).code) : null;
  const pWaveCount     = hasPrev ? uniqueCount(prevQtyRows, (r) => r.wave) : null;
  const pTotalProd     = hasPrev ? calculateRoleProductivity(prevRows, mode) : null;
  const pBranchTotal   = hasPrev ? new Set(prevQtyRows.map(r => r.branch).filter(Boolean)).size : null;
  const pBranchDay     = hasPrev ? new Set(prevQtyRows.filter(r => roleShift(r, mode)?.group === "day").map(r => r.branch).filter(Boolean)).size : null;
  const pBranchNight   = hasPrev ? new Set(prevQtyRows.filter(r => roleShift(r, mode)?.group === "night").map(r => r.branch).filter(Boolean)).size : null;

  function kpiDelta(cur, prev, lowerIsBetter = false) {
    if (!hasPrev || prev === null || prev === undefined) return "";
    return `<div class="kpi-delta-row">${deltaHtml(cur, prev, lowerIsBetter)}<span class="kpi-prev-val">${typeof prev === "number" && prev % 1 !== 0 ? fmt1.format(prev) : fmt.format(prev)}</span></div>`;
  }

  const productivityNote = (prod) => {
    const basis = mode === "sort" ? " จาก Slot Sort" : "";
    return `${fmt.format(prod.totalQtyPack)} แพ็ค / ${fmt1.format(prod.totalActiveHours)} ชม.${basis}`;
  };

  const kpis = [
    {
      color: "indigo",
      label: `${label} Qty ชิ้น`,
      value: fmt.format(totalQtyEach),
      note: `${fmt.format(items)} items`,
      delta: kpiDelta(totalQtyEach, pTotalQtyEach),
    },
    {
      color: "amber",
      label: `${label} Qty แพ็ค`,
      value: fmt.format(totalQtyPack),
      note: "AO / UOM Qty",
      delta: kpiDelta(totalQtyPack, pTotalQtyPack),
    },
    {
      color: "cyan",
      label: mode === "sort" ? "Sort รายการ" : "Sort สำเร็จ",
      value: mode === "sort" ? fmt.format(roleRows.length) : `${fmt1.format(sortedRate)}%`,
      note: mode === "sort" ? "รายการ Sort ที่มีเวลา Sort" : `${fmt.format(sorted)} รายการ`,
      delta: mode === "sort" ? kpiDelta(roleRows.length, prevRoleRows.length) : kpiDelta(sortedRate, pSortedRate),
    },
    {
      color: "teal",
      label: `${label} คน`,
      value: fmt.format(workerCount),
      note: mode === "sort" ? "Sorter" : "Picker",
      delta: kpiDelta(workerCount, pWorkers),
    },
    {
      color: "green",
      label: "Wave ทั้งหมด",
      value: fmt.format(waveCount),
      note: `${label} ในช่วงที่กรอง`,
      delta: kpiDelta(waveCount, pWaveCount),
    },
    {
      color: "cyan",
      label: `Productivity ${label}`,
      value: `${fmt1.format(totalProd.productivity)} แพ็ค/hr`,
      note: productivityNote(totalProd),
      delta: hasPrev && pTotalProd ? kpiDelta(totalProd.productivity, pTotalProd.productivity) : "",
    },
    ...(branchTotal > 0 ? [{
      color: "green",
      label: `สาขาทั้งหมด`,
      value: fmt.format(branchTotal),
      note: "Unique Branches",
      delta: kpiDelta(branchTotal, pBranchTotal),
    }] : []),
  ];

  $("#kpiGrid").innerHTML = kpis
    .map(
      ({ color, label, value, note, delta }) => `
        <article class="kpi ${color}">
          <span>${html(label)}</span>
          <strong>${html(value)}</strong>
          ${delta}
          <small>${html(note)}</small>
        </article>`
    )
    .join("");
}

function rowsForRole(rows, mode) {
  const workerKey = mode === "pick" ? "picker" : "sorter";
  const timeKey = mode === "pick" ? "pick" : "sort";
  return rows.filter((row) => row[workerKey].code && row[timeKey].at);
}

function spanActiveMinutes(dayRows, timeKey) {
  const times = dayRows.map((row) => toMs(row[timeKey].at)).filter(Boolean);
  if (!times.length) return 0;
  const span = (Math.max(...times) - Math.min(...times)) / 60000;
  return Math.max(span, dayRows.length > 1 ? 10 : 5);
}

function roleActiveMinutes(dayRows, mode, timeKey) {
  if (activeMode(mode) !== "sort") return spanActiveMinutes(dayRows, timeKey);

  const activeSlots = new Set(dayRows.map((row) => row.sort?.slotKey).filter(Boolean));
  if (activeSlots.size) return activeSlots.size * 60;

  return spanActiveMinutes(dayRows, timeKey);
}

function calculateRoleProductivity(rows, mode) {
  const timeKey = mode === "pick" ? "pick" : "sort";
  const workerKey = mode === "pick" ? "picker" : "sorter";
  const roleRows = rowsForRole(rows, mode);
  let activeMinutes = 0;

  groupBy(roleRows, (row) => row[workerKey].code).forEach((workerRows) => {
    groupBy(workerRows, (row) => rowDate(row, mode)).forEach((dayRows) => {
      activeMinutes += roleActiveMinutes(dayRows, mode, timeKey);
    });
  });

  const activeHours = activeMinutes / 60;
  const qtyPack = sumBy(roleRows, "qtyPack");
  return {
    activeHours,
    totalActiveHours: activeHours,
    productivity: activeHours ? qtyPack / activeHours : 0,
    qtyPack,
    totalQtyPack: qtyPack,
    qtyEach: sumBy(roleRows, "qtyEach"),
    totalQtyEach: sumBy(roleRows, "qtyEach"),
    rows: roleRows,
    basisLabel: activeMode(mode) === "sort" ? "Slot Sort" : "เวลาแรก-สุดท้าย",
  };
}

function roleWorkTimeSummary(rows, mode) {
  const prod = calculateRoleProductivity(rows, mode);
  const rowCount = prod.rows.length;
  const activeMinutes = prod.activeHours * 60;
  return {
    rowCount,
    activeHours: prod.activeHours,
    activeMinutes,
    avgMinutesPerRow: rowCount ? activeMinutes / rowCount : null,
  };
}

function calculateRoleProductivityByShift(rows, mode, shiftGroup) {
  return calculateRoleProductivity(
    rows.filter((row) => roleShift(row, mode)?.group === shiftGroup),
    mode
  );
}

function dailyShiftSummary(rows, mode = state.peopleMode) {
  const definitions = [
    {
      group: "day",
      label: "กะเช้า",
      shortLabel: "DAY",
      emoji: "☀️",
      colorClass: "shift-day",
      window: "07:00-16:00",
      otWindow: "16:30-19:00",
    },
    {
      group: "night",
      label: "กะดึก",
      shortLabel: "NIGHT",
      emoji: "🌙",
      colorClass: "shift-night",
      window: "19:00-04:00",
      otWindow: "04:30-07:00",
    },
  ];

  return definitions.map((definition) => {
    const groupRows = rowsForRole(
      rows.filter((row) => roleShift(row, mode)?.group === definition.group),
      mode
    );
    const otRows = groupRows.filter((row) => roleShift(row, mode)?.isOt);
    const prod = calculateRoleProductivity(groupRows, mode);
    const otProd = calculateRoleProductivity(otRows, mode);
    const branches = new Set(groupRows.map((row) => row.branch).filter(Boolean));

    return {
      ...definition,
      rows: groupRows,
      rowCount: groupRows.length,
      qtyEach: sumBy(groupRows, "qtyEach"),
      qtyPack: sumBy(groupRows, "qtyPack"),
      workers: uniqueCount(groupRows, (row) => roleWorker(row, mode).code),
      branches: branches.size,
      totalHours: prod.totalActiveHours,
      otHours: otProd.totalActiveHours,
      productivity: prod.productivity,
    };
  });
}

function hourStat(value) {
  return value > 0 ? `${fmt1.format(value)}<span class="shift-stat-unit">ชม.</span>` : "–";
}

function roleStat(label, value, note = "") {
  return `
    <div class="role-stat">
      <span>${html(label)}</span>
      <strong>${html(value)}</strong>
      ${note ? `<small>${html(note)}</small>` : ""}
    </div>`;
}

function qtyStack(each, pack) {
  return `
    <div class="qty-stack">
      <strong>${fmt.format(each)}</strong>
      <small>${fmt.format(pack)} แพ็ค</small>
    </div>`;
}

function renderRoleSplit(rows) {
  const pickRows = rowsForRole(rows, "pick");
  const sortRows = rowsForRole(rows, "sort");
  const pendingRows = rows.filter((row) => row.pick.at && !row.sort.at);
  const cycles = rows.map((row) => row.cycleMinutes).filter((value) => value !== null);
  const avgCycle = mean(cycles);
  const pickProd = calculateRoleProductivity(rows, "pick");
  const sortProd = calculateRoleProductivity(rows, "sort");
  const sortRate = pickRows.length ? (sortRows.length / pickRows.length) * 100 : 0;

  const hint = $("#roleSplitHint");
  if (hint) {
    hint.textContent = `${fmt.format(pickRows.length)} Pick / ${fmt.format(sortRows.length)} Sort`;
  }

  const cards = [
    {
      cls: "role-card-pick",
      title: "Pick",
      meta: `${fmt.format(uniqueCount(pickRows, (row) => row.picker.code))} คน`,
      stats: [
        roleStat("ชิ้น", fmt.format(sumBy(pickRows, "qtyEach"))),
        roleStat("แพ็ค", fmt.format(sumBy(pickRows, "qtyPack"))),
        roleStat("รายการ", fmt.format(pickRows.length)),
        roleStat("Wave", fmt.format(uniqueCount(pickRows, (row) => row.wave))),
        roleStat("แพ็ค/hr", pickProd.activeHours ? fmt1.format(pickProd.productivity) : "-", `${fmt1.format(pickProd.activeHours)} ชม.`),
        roleStat("Picker", fmt.format(uniqueCount(pickRows, (row) => row.picker.code))),
      ],
    },
    {
      cls: "role-card-sort",
      title: "Sort",
      meta: `${fmt.format(uniqueCount(sortRows, (row) => row.sorter.code))} คน`,
      stats: [
        roleStat("ชิ้น", fmt.format(sumBy(sortRows, "qtyEach"))),
        roleStat("แพ็ค", fmt.format(sumBy(sortRows, "qtyPack"))),
        roleStat("รายการ", fmt.format(sortRows.length)),
        roleStat("Sort ครบ", pickRows.length ? `${fmt1.format(sortRate)}%` : "-"),
        roleStat("แพ็ค/hr", sortProd.activeHours ? fmt1.format(sortProd.productivity) : "-", `${fmt1.format(sortProd.activeHours)} ชม.`),
        roleStat("Sorter", fmt.format(uniqueCount(sortRows, (row) => row.sorter.code))),
      ],
    },
    {
      cls: "role-card-balance",
      title: "ยังไม่ Sort",
      meta: `${fmt.format(pendingRows.length)} รายการ`,
      stats: [
        roleStat("ชิ้น", fmt.format(sumBy(pendingRows, "qtyEach"))),
        roleStat("แพ็ค", fmt.format(sumBy(pendingRows, "qtyPack"))),
        roleStat("รายการ", fmt.format(pendingRows.length)),
        roleStat("เฉลี่ย Pick→Sort", avgCycle !== null ? metricMinutes(avgCycle) : "-"),
        roleStat("Pick มากกว่า Sort", fmt.format(Math.max(0, sumBy(pickRows, "qtyEach") - sumBy(sortRows, "qtyEach"))), "ชิ้น"),
        roleStat("Sort สำเร็จ", pickRows.length ? `${fmt1.format(sortRate)}%` : "-"),
      ],
    },
  ];

  const container = $("#roleSplitCards");
  if (!container) return;
  container.innerHTML = cards
    .map(
      (card) => `
        <article class="role-card ${card.cls}">
          <div class="role-card-head">
            <div>
              <span class="role-label">${html(card.title)}</span>
            </div>
            <strong>${html(card.meta)}</strong>
          </div>
          <div class="role-stat-grid">${card.stats.join("")}</div>
        </article>`
    )
    .join("");
}

function renderRoleSlots(rows) {
  const slots = Array.from({ length: 24 }, (_, hour) => ({
    key: `${hour}`.padStart(2, "0"),
    label: `${hour}`.padStart(2, "0") + ":00",
    pickRows: 0,
    sortRows: 0,
    pendingRows: 0,
    pickQtyEach: 0,
    sortQtyEach: 0,
    pendingQtyEach: 0,
  }));
  const bySlot = new Map(slots.map((slot) => [slot.key, slot]));

  rows.forEach((row) => {
    if (row.pick.slotKey && bySlot.has(row.pick.slotKey)) {
      const slot = bySlot.get(row.pick.slotKey);
      slot.pickRows += 1;
      slot.pickQtyEach += row.qtyEach || 0;
      if (!row.sort.at) {
        slot.pendingRows += 1;
        slot.pendingQtyEach += row.qtyEach || 0;
      }
    }
    if (row.sort.slotKey && bySlot.has(row.sort.slotKey)) {
      const slot = bySlot.get(row.sort.slotKey);
      slot.sortRows += 1;
      slot.sortQtyEach += row.qtyEach || 0;
    }
  });

  const visible = slots.filter((slot) => slot.pickRows || slot.sortRows);
  const hint = $("#roleSlotHint");
  if (hint) hint.textContent = `${fmt.format(visible.length)} slots`;

  const table = $("#roleSlotTable");
  if (!table) return;
  if (!visible.length) {
    table.innerHTML = `<tr><td colspan="7" class="empty">ไม่มีข้อมูล</td></tr>`;
    return;
  }

  const maxQty = Math.max(...visible.map((slot) => Math.max(slot.pickQtyEach, slot.sortQtyEach)), 1);
  table.innerHTML = visible
    .map((slot) => {
      const pickPct = (slot.pickQtyEach / maxQty) * 100;
      const sortPct = (slot.sortQtyEach / maxQty) * 100;
      return `
        <tr>
          <td><span class="tag">${slot.label}</span></td>
          <td>
            <div class="role-slot-bars">
              <div class="role-slot-line"><span>Pick</span><div><i class="pick" style="width:${pickPct}%"></i></div></div>
              <div class="role-slot-line"><span>Sort</span><div><i class="sort" style="width:${sortPct}%"></i></div></div>
            </div>
          </td>
          <td class="num">${fmt.format(slot.pickQtyEach)}</td>
          <td class="num">${fmt.format(slot.pickRows)}</td>
          <td class="num">${fmt.format(slot.sortQtyEach)}</td>
          <td class="num">${fmt.format(slot.sortRows)}</td>
          <td class="num">${slot.pendingQtyEach ? fmt.format(slot.pendingQtyEach) : "-"}</td>
        </tr>`;
    })
    .join("");
}

function renderRolePeopleTable(selector, hintSelector, rows, mode) {
  const table = $(selector);
  const hint = $(hintSelector);
  if (!table) return;
  const people = employeeSummary(rows, mode).slice(0, 10);
  if (hint) hint.textContent = `${fmt.format(people.length)} คน`;
  if (!people.length) {
    table.innerHTML = `<tr><td colspan="5" class="empty">ไม่มีข้อมูล</td></tr>`;
    return;
  }
  table.innerHTML = people
    .map((person) => {
      const label = workerDisplayName(person.worker);
      return `
        <tr>
          <td><span class="tag">${html(person.worker.code || "-")}</span></td>
          <td>${html(label)}</td>
          <td class="num">${fmt.format(person.qtyEach)}</td>
          <td class="num">${fmt.format(person.qtyPack)}</td>
          <td class="num">${person.rateEach ? fmt1.format(person.rateEach) : "-"}</td>
        </tr>`;
    })
    .join("");
}

function renderPickSortView(rows) {
  if (activeMode() === "sort") {
    ["#roleSplitCards", "#roleSlotTable", "#topPickTable"].forEach((selector) => {
      const el = $(selector);
      if (el) el.innerHTML = "";
    });
    renderRolePeopleTable("#topSortTable", "#topSortHint", rows, "sort");
    return;
  }

  renderRoleSplit(rows);
  renderRoleSlots(rows);
  renderRolePeopleTable("#topPickTable", "#topPickHint", rows, "pick");
  renderRolePeopleTable("#topSortTable", "#topSortHint", rows, "sort");
}

// (debug helpers removed)

function rowsForShiftSummary(rows, key) {
  if (key === "transition") return rows.filter((row) => row.shift?.group === "transition");
  return rows.filter((row) => row.shift?.key === key);
}

function renderShiftSummary(rows) {
  $("#shiftHint").textContent = "ใช้เวลา Pick เป็นหลัก ถ้าไม่มี Pick จะใช้เวลา Sort";
  const tableRows = SHIFT_SUMMARY_ROWS.map((definition) => {
    const items = rowsForShiftSummary(rows, definition.key);
    const cycles = items.map((row) => row.cycleMinutes);
    const sorted = items.filter((row) => row.sort.at).length;
    const workers = uniqueCount(items, (row) => row.picker.code) + uniqueCount(items, (row) => row.sorter.code);
    const sortedRate = items.length ? (sorted / items.length) * 100 : 0;
    return { ...definition, items, sortedRate, workers, avgCycle: mean(cycles) };
  }).filter(r => r.items && r.items.length > 0);

  // เพิ่ม rows ที่ไม่มี shift ลงในแถวสุดท้าย
  const unassignedRows = rows.filter((row) => !row.shift || (!row.shift.key && !row.shift.group));
  if (unassignedRows.length) {
    const cycles = unassignedRows.map((row) => row.cycleMinutes);
    const sorted = unassignedRows.filter((row) => row.sort.at).length;
    const workers = uniqueCount(unassignedRows, (row) => row.picker.code) + uniqueCount(unassignedRows, (row) => row.sorter.code);
    const sortedRate = unassignedRows.length ? (sorted / unassignedRows.length) * 100 : 0;
    tableRows.push({ 
      key: "unassigned", 
      label: "ไม่มีการจัดกะ", 
      window: "-", 
      group: "unassigned", 
      items: unassignedRows, 
      sortedRate, 
      workers, 
      avgCycle: mean(cycles) 
    });
  }

  if (!tableRows.some((row) => row.items.length)) {
    $("#shiftTable").innerHTML = `<tr><td colspan="7" class="empty">ไม่มีข้อมูล</td></tr>`;
    return;
  }

  let htmlStr = "";
  let lastGroup = "";
  const groupLabels = {
    day: "☀️ DAY (Day Shift)",
    night: "🌙 NIGHT (Night Shift)",
    transition: "🔄 อื่น ๆ (Others / Transition)",
    unassigned: "❓ ไม่มีการจัดกะ",
  };

  tableRows.forEach((row) => {
    if (row.group !== lastGroup) {
      lastGroup = row.group;
      htmlStr += `
        <tr class="group-header">
          <td colspan="7">${groupLabels[row.group]}</td>
        </tr>`;
    }
    htmlStr += `
      <tr>
        <td><span class="tag tag-${row.group}">${html(row.label)}</span></td>
        <td class="num">${fmt.format(sumBy(row.items, "qtyEach"))}</td>
        <td class="num">${fmt.format(sumBy(row.items, "qtyPack"))}</td>
        <td class="num">${row.items.length ? `${fmt1.format(row.sortedRate)}%` : "-"}</td>
        <td class="num">${metricMinutes(row.avgCycle)}</td>
        <td class="num">${fmt.format(row.workers)}</td>
      </tr>`;
  });

  $("#shiftTable").innerHTML = htmlStr;
}

function dailySummary(rows, mode = state.peopleMode) {
  return [...groupBy(rowsForRole(rows, mode), (row) => rowDate(row, mode)).entries()]
    .map(([date, items]) => {
      const workTime = roleWorkTimeSummary(items, mode);
      return {
        date,
        qtyPack: sumBy(items, "qtyPack"),
        qtyEach: sumBy(items, "qtyEach"),
        avgCycle: workTime.avgMinutesPerRow,
      };
    })
    .sort((a, b) => a.date.localeCompare(b.date));
}

function renderDailyChart(rows) {
  const mode = activeMode();
  const label = roleLabel(mode);
  const roleRows = rowsForRole(rows, mode);
  const daily = dailySummary(rows, mode);
  $("#dailyHint").textContent = `${label} · ${fmt.format(daily.length)} วัน · ${fmt.format(sumBy(roleRows, "qtyEach"))} ชิ้น / ${fmt.format(sumBy(roleRows, "qtyPack"))} แพ็ค`;
  if (!daily.length) {
    $("#dailyChart").innerHTML = `<div class="empty">ไม่มีข้อมูล</div>`;
    return;
  }

  const width = 1200;
  const height = 500;
  const pad = { top: 68, right: 60, bottom: 50, left: 64 };
  const innerW = width - pad.left - pad.right;
  const innerH = height - pad.top - pad.bottom;
  const maxQty = Math.max(...daily.map((day) => Math.max(day.qtyEach, day.qtyPack)), 1);
  const maxCycle = Math.max(...daily.map((day) => day.avgCycle || 0), 1);
  // Two bars per day: ชิ้น and แพ็ค
  const groupW = Math.min(100, innerW / daily.length - 6);
  const barW = Math.max(8, (groupW - 6) / 2);
  const xFor = (index) => pad.left + ((index + 0.5) * innerW) / daily.length;
  const yQty = (value) => pad.top + innerH - (value / maxQty) * innerH;
  const yCycle = (value) => pad.top + innerH - (value / maxCycle) * innerH;
  
  // Smooth curve or straight line points
  const linePoints = daily.map((day, index) => `${xFor(index)},${yCycle(day.avgCycle || 0)}`).join(" ");
  const skip = Math.ceil(daily.length / 8);

  // Horizontal grid lines
  const gridLines = [0, 0.25, 0.5, 0.75, 1].map(ratio => {
    const y = pad.top + innerH - (innerH * ratio);
    return `<line x1="${pad.left}" x2="${width - pad.right}" y1="${y}" y2="${y}" stroke="rgba(148,163,184,0.12)" stroke-dasharray="4 6" stroke-width="1"/>`;
  }).join("");

  const bars = daily
    .map((day, index) => {
      const cx = xFor(index);
      // Bar ชิ้น (left, teal)
      const xEach = cx - barW - 2;
      const hEach = Math.max((day.qtyEach / maxQty) * innerH, 4);
      const yEach = pad.top + innerH - hEach;
      // Bar แพ็ค (right, indigo)
      const xPack = cx + 2;
      const hPack = Math.max((day.qtyPack / maxQty) * innerH, 4);
      const yPack = pad.top + innerH - hPack;
      // Compute font size: smaller when many days
      const fontSize = daily.length > 20 ? 12 : daily.length > 10 ? 13 : 15;
      return `
        <g class="chart-group">
          <rect class="chart-bar chart-bar-each" x="${xEach}" y="${yEach}" width="${barW}" height="${hEach}" rx="4" fill="url(#barGradEach)" opacity="0.92">
            <title>${html(day.date)}: ${fmt.format(day.qtyEach)} ชิ้น</title>
          </rect>
          <text class="chart-val-always chart-val-each" x="${xEach + barW / 2}" y="${yEach - 6}" text-anchor="middle" font-size="${fontSize}">${fmt.format(day.qtyEach)}</text>
          <rect class="chart-bar chart-bar-pack" x="${xPack}" y="${yPack}" width="${barW}" height="${hPack}" rx="4" fill="url(#barGradPack)" opacity="0.88">
            <title>${html(day.date)}: ${fmt.format(day.qtyPack)} แพ็ค</title>
          </rect>
          <text class="chart-val-always chart-val-pack" x="${xPack + barW / 2}" y="${yPack - 6}" text-anchor="middle" font-size="${fontSize}">${fmt.format(day.qtyPack)}</text>
        </g>`;
    })
    .join("");

  const labels = daily
    .map((day, index) => {
      if (index % skip !== 0 && index !== daily.length - 1 && index !== 0) return "";
      return `<text class="axis-label" x="${xFor(index)}" y="${height - 14}" text-anchor="middle">${html(day.date.slice(5).replace('-','/'))}</text>`;
    })
    .join("");

  $("#dailyChart").innerHTML = `
    <svg viewBox="0 0 ${width} ${height}" role="img" aria-label="Daily throughput chart">
      <defs>
        <linearGradient id="barGradEach" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="#2dd4bf"/>
          <stop offset="100%" stop-color="#0f766e" stop-opacity="0.2"/>
        </linearGradient>
        <linearGradient id="barGradPack" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="#60a5fa"/>
          <stop offset="100%" stop-color="#1e40af" stop-opacity="0.2"/>
        </linearGradient>
        <linearGradient id="lineGrad" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stop-color="#818cf8"/>
          <stop offset="50%" stop-color="#a78bfa"/>
          <stop offset="100%" stop-color="#c084fc"/>
        </linearGradient>
        <filter id="glow" x="-20%" y="-20%" width="140%" height="140%">
          <feGaussianBlur stdDeviation="3" result="blur" />
          <feComposite in="SourceGraphic" in2="blur" operator="over" />
        </filter>
      </defs>
      
      ${gridLines}
      <line x1="${pad.left}" x2="${width - pad.right}" y1="${pad.top + innerH}" y2="${pad.top + innerH}" stroke="rgba(148,163,184,0.3)" stroke-width="1.5"/>
      
      ${bars}
      
      <polyline points="${linePoints}" fill="none" stroke="url(#lineGrad)" stroke-width="3" filter="url(#glow)" stroke-linejoin="round" stroke-linecap="round" class="chart-line"/>
      
      ${daily
        .map((day, index) => `
          <g class="chart-point-group">
            <circle cx="${xFor(index)}" cy="${yCycle(day.avgCycle || 0)}" r="4.5" fill="#0f172a" stroke="url(#lineGrad)" stroke-width="2.5" class="chart-point">
              <title>${html(day.date)}: ${metricMinutes(day.avgCycle)}</title>
            </circle>
          </g>`)
        .join("")}
        
      ${labels}
      <text class="axis-label axis-title" x="${pad.left}" y="18">Qty</text>
      <text class="axis-label axis-title" x="${width - pad.right}" y="18" text-anchor="end">เฉลี่ย (นาที)</text>
    </svg>
    <div class="legend" style="margin-top: 10px;">
      <span><i style="background: linear-gradient(135deg, #2dd4bf, #0f766e)"></i>ชิ้น</span>
      <span><i style="background: linear-gradient(135deg, #60a5fa, #1e40af)"></i>แพ็ค</span>
      <span><i style="background: linear-gradient(135deg, #818cf8, #c084fc)"></i>${label} เฉลี่ย/รายการ</span>
    </div>`;
}

function renderSlots(rows) {
  const mode = activeMode();
  const label = roleLabel(mode);
  const visible = slotSummary(rows, mode);
  const maxCount = Math.max(...visible.map((s) => s.count), 1);
  const maxQtyEach = Math.max(...visible.map((s) => s.qtyEach), 1);
  const totalQtyEach = visible.reduce((s, v) => s + v.qtyEach, 0);
  const totalQtyPack = visible.reduce((s, v) => s + v.qtyPack, 0);
  const totalBranches = new Set(visible.flatMap(s => [...(s.branches || [])])).size || visible.reduce((s, v) => s + v.branchCount, 0);

  $("#slotHint").textContent = `${label} · ${fmt.format(visible.length)} slots`;

  const grid = $("#slotGrid");
  const legend = $("#slotLegend");

  if (!visible.length) {
    grid.innerHTML = `<div class="slot-empty">ไม่มีข้อมูล</div>`;
    legend.style.display = "none";
    return;
  }

  const isPick = mode !== "sort";
  const accentVar = isPick ? "var(--teal)" : "var(--indigo)";
  const accentBright = isPick ? "var(--teal-bright)" : "#c4b5fd";
  const glowVar = isPick ? "var(--teal-glow)" : "var(--indigo-glow)";
  const gradStart = isPick ? "#0d9488" : "#7c3aed";
  const gradEnd = isPick ? "#2dd4bf" : "#a78bfa";

  grid.innerHTML = visible
    .map((slot, idx) => {
      const pct = (slot.qtyEach / maxQtyEach) * 100;
      const sharePct = totalQtyEach ? ((slot.qtyEach / totalQtyEach) * 100).toFixed(1) : "0";
      const delay = idx * 40;
      return `
        <div class="slot-card" style="animation-delay:${delay}ms" title="${slot.label} — ${fmt.format(slot.count)} รายการ">
          <div class="slot-card-header">
            <span class="slot-time-badge" style="background:${accentVar};color:#fff">${slot.label}</span>
            <span class="slot-share" style="color:${accentBright}">${sharePct}%</span>
          </div>
          <div class="slot-bar-container">
            <div class="slot-bar-bg">
              <div class="slot-bar-fill" style="width:${pct}%;background:linear-gradient(90deg,${gradStart},${gradEnd});box-shadow:0 0 12px ${glowVar}"></div>
            </div>
          </div>
          <div class="slot-card-stats">
            <div class="slot-stat">
              <span class="slot-stat-value">${fmt.format(slot.qtyEach)}</span>
              <span class="slot-stat-label">ชิ้น</span>
            </div>
            <div class="slot-stat">
              <span class="slot-stat-value">${fmt.format(slot.qtyPack)}</span>
              <span class="slot-stat-label">แพ็ค</span>
            </div>
            <div class="slot-stat">
              <span class="slot-stat-value" style="color:${accentBright}">${slot.branchCount ? fmt.format(slot.branchCount) : "-"}</span>
              <span class="slot-stat-label">สาขา</span>
            </div>
          </div>
        </div>`;
    })
    .join("");

  legend.innerHTML = `
    <div class="slot-legend-summary">
      <span><i style="background:${accentVar}"></i>${label}</span>
      <span class="slot-legend-totals">รวม: <strong>${fmt.format(totalQtyEach)}</strong> ชิ้น · <strong>${fmt.format(totalQtyPack)}</strong> แพ็ค · <strong>${fmt.format(totalBranches)}</strong> สาขา</span>
    </div>`;
  legend.style.display = "";
}

function slotSummary(rows, mode = state.peopleMode) {
  const roleRows = rowsForRole(rows, mode);
  const slots = Array.from({ length: 24 }, (_, hour) => ({
    key: `${hour}`.padStart(2, "0"),
    label: `${hour}`.padStart(2, "0") + ":00",
    count: 0,
    qtyEach: 0,
    qtyPack: 0,
    branches: new Set(),
  }));
  const bySlot = new Map(slots.map((slot) => [slot.key, slot]));
  roleRows.forEach((row) => {
    const time = roleTime(row, mode);
    if (time?.slotKey && bySlot.has(time.slotKey)) {
      const slot = bySlot.get(time.slotKey);
      slot.count += 1;
      slot.qtyEach += row.qtyEach || 0;
      slot.qtyPack += row.qtyPack || 0;
      if (row.branch) slot.branches.add(row.branch);
    }
  });
  return slots.filter((slot) => slot.count).map(slot => ({
    ...slot,
    branchCount: slot.branches.size,
  }));
}

function employeeSlotSummary(rows) {
  const byWorkerSlot = new Map();

  function ensureEntry(worker, time) {
    const slotKey = time.slotKey;
    const key = `${slotKey}|${worker.code}`;
    if (!byWorkerSlot.has(key)) {
      byWorkerSlot.set(key, {
        slotKey,
        slotLabel: `${slotKey}:00`,
        worker,
        days: new Set(),
        branches: new Set(),
        pickBranches: new Set(),
        sortBranches: new Set(),
        pickDays: new Set(),
        sortDays: new Set(),
        pickRows: 0,
        pickQtyEach: 0,
        pickQtyPack: 0,
        sortRows: 0,
        sortQtyEach: 0,
        sortQtyPack: 0,
      });
    }
    return byWorkerSlot.get(key);
  }

  rows.forEach((row) => {
    if (row.picker.code && row.pick?.slotKey) {
      const entry = ensureEntry(row.picker, row.pick);
      entry.pickRows += 1;
      entry.pickQtyEach += row.qtyEach || 0;
      entry.pickQtyPack += row.qtyPack || 0;
      if (row.pick.date) {
        entry.days.add(row.pick.date);
        entry.pickDays.add(row.pick.date);
      }
      if (row.branch) {
        entry.branches.add(row.branch);
        entry.pickBranches.add(row.branch);
      }
    }

    if (row.sorter.code && row.sort?.slotKey) {
      const entry = ensureEntry(row.sorter, row.sort);
      entry.sortRows += 1;
      entry.sortQtyEach += row.qtyEach || 0;
      entry.sortQtyPack += row.qtyPack || 0;
      if (row.sort.date) {
        entry.days.add(row.sort.date);
        entry.sortDays.add(row.sort.date);
      }
      if (row.branch) {
        entry.branches.add(row.branch);
        entry.sortBranches.add(row.branch);
      }
    }
  });

  return [...byWorkerSlot.values()]
    .map((entry) => ({
      ...entry,
      dayCount: entry.days.size,
      pickDayCount: entry.pickDays.size,
      sortDayCount: entry.sortDays.size,
      branchCount: entry.branches.size,
      pickBranchCount: entry.pickBranches.size,
      sortBranchCount: entry.sortBranches.size,
      pickWorkMinutes: entry.pickDays.size * 60,
      sortWorkMinutes: entry.sortDays.size * 60,
      pickAvgMinutes: entry.pickRows ? (entry.pickDays.size * 60) / entry.pickRows : null,
      sortAvgMinutes: entry.sortRows ? (entry.sortDays.size * 60) / entry.sortRows : null,
      totalQtyEach: entry.pickQtyEach + entry.sortQtyEach,
      totalRows: entry.pickRows + entry.sortRows,
    }))
    .sort((a, b) => a.slotKey.localeCompare(b.slotKey) || b.totalQtyEach - a.totalQtyEach || workerDisplayName(a.worker).localeCompare(workerDisplayName(b.worker)));
}

function roleEmployeeSlotSummary(rows, mode) {
  const workerKey = mode === "pick" ? "picker" : "sorter";
  const timeKey = mode === "pick" ? "pick" : "sort";
  const entries = new Map();

  rowsForRole(rows, mode).forEach((row) => {
    const worker = row[workerKey];
    const time = row[timeKey];
    if (!worker.code || !time?.slotKey) return;
    const key = `${time.slotKey}|${worker.code}`;
    if (!entries.has(key)) {
      entries.set(key, {
        slotKey: time.slotKey,
        slotLabel: `${time.slotKey}:00`,
        worker,
        days: new Set(),
        branches: new Set(),
        qtyEach: 0,
        qtyPack: 0,
        rowCount: 0,
      });
    }
    const entry = entries.get(key);
    entry.qtyEach += row.qtyEach || 0;
    entry.qtyPack += row.qtyPack || 0;
    entry.rowCount += 1;
    if (time.date) entry.days.add(time.date);
    if (row.branch) entry.branches.add(row.branch);
  });

  return [...entries.values()]
    .map((entry) => ({
      ...entry,
      dayCount: entry.days.size,
      branchCount: entry.branches.size,
      workMinutes: entry.days.size * 60,
      avgMinutesPerRow: entry.rowCount ? (entry.days.size * 60) / entry.rowCount : null,
    }))
    .sort((a, b) => a.slotKey.localeCompare(b.slotKey) || b.qtyEach - a.qtyEach || workerDisplayName(a.worker).localeCompare(workerDisplayName(b.worker)));
}

function peakSlotLabel(entries) {
  const slots = new Map();
  entries.forEach((entry) => {
    const current = slots.get(entry.slotKey) || { slotLabel: entry.slotLabel, qtyEach: 0 };
    current.qtyEach += entry.qtyEach;
    slots.set(entry.slotKey, current);
  });
  const peak = [...slots.values()].sort((a, b) => b.qtyEach - a.qtyEach)[0];
  return peak ? `${peak.slotLabel} · ${fmt.format(peak.qtyEach)} ชิ้น` : "-";
}

function employeeSummary(rows, mode) {
  const workerKey = mode === "pick" ? "picker" : "sorter";
  const timeKey = mode === "pick" ? "pick" : "sort";
  const completedRows = rows.filter((row) => row[workerKey].code && row[timeKey].at);
  
  return [...groupBy(completedRows, (row) => row[workerKey].code).entries()]
    .map(([, items]) => {
      const worker = items[0][workerKey];
      const days = groupBy(items, (row) => rowDate(row, mode));
      let activeMinutes = 0;
      days.forEach((dayRows) => {
        activeMinutes += roleActiveMinutes(dayRows, mode, timeKey);
      });
      const activeHours = activeMinutes / 60;
      const qtyEach = sumBy(items, "qtyEach");
      const qtyPack = sumBy(items, "qtyPack");
      const branches = new Set(items.map((row) => row.branch).filter(Boolean));
      const rowCount = items.length;
      return {
        worker,
        qtyEach,
        qtyPack,
        rowCount,
        waves: uniqueCount(items, (row) => row.wave),
        branchCount: branches.size,
        activeHours,
        activeMinutes,
        rateEach: activeHours ? qtyEach / activeHours : null,
        avgWorkMinutes: rowCount ? activeMinutes / rowCount : null,
        avgCycle: mean(items.map((row) => row.cycleMinutes)),
      };
    })
    .sort((a, b) => (a.avgWorkMinutes ?? Infinity) - (b.avgWorkMinutes ?? Infinity) || b.qtyEach - a.qtyEach || b.waves - a.waves);
}

function renderPeople(rows) {
  const people = employeeSummary(rows, state.peopleMode).slice(0, 18);
  $("#peopleHint").textContent = state.peopleMode === "pick" ? "จัดอันดับ Pick ตามเวลาเฉลี่ย/รายการ" : "จัดอันดับ Sort ตามเวลาเฉลี่ย/รายการ";
  if (!people.length) {
    $("#peopleTable").innerHTML = `<tr><td colspan="8" class="empty">ไม่มีข้อมูล</td></tr>`;
    return;
  }
  const medals  = ["🥇", "🥈", "🥉"];
  $("#peopleTable").innerHTML = people.map((person, idx) => {
    const label   = workerDisplayName(person.worker);
    const rank    = idx < 3 ? medals[idx] : `<span class="rank-num">#${idx + 1}</span>`;
    return `
      <tr>
        <td><span class="tag">${html(person.worker.code || "-")}</span></td>
        <td>
          <div class="person-cell">
            <div class="person-name-row">${rank} <strong>${html(label)}</strong></div>
            <small>${html(person.worker.role || person.worker.zone || "")}</small>
          </div>
        </td>
        <td class="num">${fmt.format(person.qtyEach)}</td>
        <td class="num">${fmt.format(person.qtyPack)}</td>
        <td class="num">${fmt.format(person.waves)}</td>
        <td class="num">${fmt.format(person.branchCount)}</td>
        <td class="num">${person.activeHours ? `${fmt1.format(person.activeHours)} ชม.` : "-"}</td>
        <td class="num">${metricMinutes(person.avgWorkMinutes)}</td>
      </tr>`;
  }).join("");
}

function renderEmployeeSlots(rows) {
  const table = $("#employeeSlotTable");
  if (!table) return;

  const mode = activeMode();
  const label = roleLabel(mode);
  const summary = roleEmployeeSlotSummary(rows, mode);
  const hint = $("#employeeSlotHint");
  if (hint) {
    hint.textContent = `${fmt.format(summary.length)} แถวคน/ชั่วโมง · ${label} · ตาม filter ปัจจุบัน`;
  }

  const head = table.closest("table")?.querySelector("thead");
  if (head) {
    head.innerHTML = `
      <tr>
        <th>Slot</th>
        <th>รหัส</th>
        <th>ชื่อจริง</th>
        <th class="num">วัน</th>
        <th class="num">${label} ชิ้น</th>
        <th class="num">${label} แพ็ค</th>
        <th class="num">${label} รายการ</th>
        <th class="num">เวลางาน</th>
        <th class="num">เฉลี่ย/รายการ</th>
        <th class="num">สาขา</th>
        <th class="num">สัดส่วน</th>
      </tr>`;
  }

  if (!summary.length) {
    table.innerHTML = `<tr><td colspan="11" class="empty">ไม่มีข้อมูล</td></tr>`;
    return;
  }

  const maxTotal = Math.max(...summary.map((entry) => entry.qtyEach), 1);
  const numClass = mode === "sort" ? "sort-num" : "pick-num";
  table.innerHTML = summary
    .map((entry) => {
      const totalPct = (entry.qtyEach / maxTotal) * 100;
      const name = workerDisplayName(entry.worker);
      return `
        <tr>
          <td><span class="slot-time-badge employee-slot-time">${html(entry.slotLabel)}</span></td>
          <td><span class="tag">${html(entry.worker.code || "-")}</span></td>
          <td>
            <div class="employee-slot-worker">
              <strong>${html(name)}</strong>
              <small>${html(entry.worker.role || entry.worker.zone || "")}</small>
            </div>
          </td>
          <td class="num">${entry.dayCount ? fmt.format(entry.dayCount) : "-"}</td>
          <td class="num ${numClass}">${entry.qtyEach ? fmt.format(entry.qtyEach) : "-"}</td>
          <td class="num ${numClass}">${entry.qtyPack ? fmt.format(entry.qtyPack) : "-"}</td>
          <td class="num ${numClass}">${entry.rowCount ? fmt.format(entry.rowCount) : "-"}</td>
          <td class="num">${metricMinutes(entry.workMinutes)}</td>
          <td class="num">${metricMinutes(entry.avgMinutesPerRow)}</td>
          <td class="num">${entry.branchCount ? fmt.format(entry.branchCount) : "-"}</td>
          <td class="num">
            <div class="employee-slot-total">
              <strong>${fmt.format(entry.qtyEach)}</strong>
              <span><i style="width:${totalPct}%"></i></span>
            </div>
          </td>
        </tr>`;
    })
    .join("");
}

function renderEmployeeSlotOverview(rows) {
  const grid = $("#employeeSlotKpis");
  if (!grid) return;

  const mode = activeMode();
  const label = roleLabel(mode);
  const entries = roleEmployeeSlotSummary(rows, mode);
  const workers = new Set(entries.map((entry) => entry.worker.code).filter(Boolean));
  const slots = new Set(entries.map((entry) => entry.slotKey).filter(Boolean));
  const qty = entries.reduce((sum, entry) => sum + entry.qtyEach, 0);
  const roleTimeSummary = roleWorkTimeSummary(rows, mode);

  const hint = $("#employeeSlotOverviewHint");
  if (hint) hint.textContent = `${fmt.format(workers.size)} คน · ${fmt.format(slots.size)} slot · ตาม filter ปัจจุบัน`;

  const cards = [
    ["cyan", "คนที่มีงาน", fmt.format(workers.size), `${fmt.format(entries.length)} แถวคน/ชั่วโมง`],
    ["green", `${label} รวม`, fmt.format(qty), `${fmt.format(entries.length)} แถว ${label}/Slot`],
    ["amber", `${label} เฉลี่ย/รายการ`, metricMinutes(roleTimeSummary.avgMinutesPerRow), `${fmt1.format(roleTimeSummary.activeHours)} ชม. / ${fmt.format(roleTimeSummary.rowCount)} รายการ`],
    ["rose", "Peak Slot", peakSlotLabel(entries), "ชั่วโมงที่มีชิ้นมากสุด"],
  ];

  grid.innerHTML = cards
    .map(([tone, label, value, note]) => `
      <article class="insight-card ${tone}">
        <span>${html(label)}</span>
        <strong>${html(value)}</strong>
        <small>${html(note)}</small>
      </article>`)
    .join("");
}

function renderEmployeeHeatmap(rows, mode) {
  const container = $(`#${mode}Heatmap`);
  const hint = $(`#${mode}HeatmapHint`);
  if (!container) return;

  const entries = roleEmployeeSlotSummary(rows, mode);
  const label = roleLabel(mode);
  if (hint) hint.textContent = `${label} · Top 14 คนตามยอดชิ้น`;
  if (!entries.length) {
    container.innerHTML = `<div class="slot-empty">ไม่มีข้อมูล</div>`;
    return;
  }

  const activeSlots = Array.from({ length: 24 }, (_, hour) => String(hour).padStart(2, "0"));
  const byWorker = new Map();
  entries.forEach((entry) => {
    const key = entry.worker.code;
    if (!byWorker.has(key)) {
      byWorker.set(key, {
        worker: entry.worker,
        qtyBySlot: new Map(),
        totalQty: 0,
        rowCount: 0,
      });
    }
    const worker = byWorker.get(key);
    worker.qtyBySlot.set(entry.slotKey, (worker.qtyBySlot.get(entry.slotKey) || 0) + entry.qtyEach);
    worker.totalQty += entry.qtyEach;
    worker.rowCount += entry.rowCount;
  });

  const workers = [...byWorker.values()]
    .sort((a, b) => b.totalQty - a.totalQty || workerDisplayName(a.worker).localeCompare(workerDisplayName(b.worker)))
    .slice(0, 14);
  const maxCell = Math.max(...workers.flatMap((worker) => activeSlots.map((slot) => worker.qtyBySlot.get(slot) || 0)), 1);
  const toneClass = mode === "pick" ? "heatmap-pick" : "heatmap-sort";

  container.innerHTML = `
    <div class="heatmap-scroll">
      <table class="employee-hour-table ${toneClass}">
        <thead>
          <tr>
            <th class="employee-hour-person-head">พนักงาน</th>
            ${activeSlots.map((slot) => `<th class="employee-hour-slot">${slot}:00</th>`).join("")}
            <th class="employee-hour-total-head">รวม</th>
          </tr>
        </thead>
        <tbody>
          ${workers.map((worker) => `
            <tr>
              <th class="employee-hour-person">
                <strong>${html(workerDisplayName(worker.worker))}</strong>
                <small>${html(worker.worker.code || "-")} · ${fmt.format(worker.rowCount)} รายการ</small>
              </th>
              ${activeSlots.map((slot) => {
                const qty = worker.qtyBySlot.get(slot) || 0;
                const intensity = qty ? 0.16 + (qty / maxCell) * 0.84 : 0;
                return `<td class="employee-hour-cell" style="--heat:${intensity}" title="${html(workerDisplayName(worker.worker))} ${slot}:00 · ${fmt.format(qty)} ชิ้น">${qty ? fmt.format(qty) : ""}</td>`;
              }).join("")}
              <td class="employee-hour-total">${fmt.format(worker.totalQty)}</td>
            </tr>
          `).join("")}
        </tbody>
      </table>
    </div>`;
}

function renderRoleSlotEmployeeTable(rows, mode) {
  const table = $(`#${mode}SlotEmployeeTable`);
  const hint = $(`#${mode}SlotEmployeeHint`);
  if (!table) return;

  const entries = roleEmployeeSlotSummary(rows, mode);
  const label = roleLabel(mode);
  if (hint) hint.textContent = `${label} · Top 5 คนต่อ slot`;
  if (!entries.length) {
    table.innerHTML = `<tr><td colspan="8" class="empty">ไม่มีข้อมูล</td></tr>`;
    return;
  }

  const bySlot = groupBy(entries, (entry) => entry.slotKey);
  const rowsToShow = [];
  [...bySlot.keys()].sort((a, b) => a.localeCompare(b)).forEach((slotKey) => {
    const slotRows = (bySlot.get(slotKey) || []).sort((a, b) => b.qtyEach - a.qtyEach).slice(0, 5);
    slotRows.forEach((entry, index) => rowsToShow.push({ ...entry, slotRank: index + 1 }));
  });

  const maxQty = Math.max(...rowsToShow.map((entry) => entry.qtyEach), 1);
  table.innerHTML = rowsToShow
    .map((entry) => {
      const pct = (entry.qtyEach / maxQty) * 100;
      return `
        <tr>
          <td><span class="slot-time-badge employee-slot-time">${html(entry.slotLabel)}</span></td>
          <td>
            <div class="employee-slot-worker">
              <strong>#${entry.slotRank} ${html(workerDisplayName(entry.worker))}</strong>
              <small>${html(entry.worker.code || "-")}</small>
            </div>
          </td>
          <td class="num">
            <div class="employee-slot-total">
              <strong>${fmt.format(entry.qtyEach)}</strong>
              <span><i style="width:${pct}%"></i></span>
            </div>
          </td>
          <td class="num">${entry.qtyPack ? fmt.format(entry.qtyPack) : "-"}</td>
          <td class="num">${fmt.format(entry.rowCount)}</td>
          <td class="num">${metricMinutes(entry.workMinutes)}</td>
          <td class="num">${metricMinutes(entry.avgMinutesPerRow)}</td>
          <td class="num">${entry.branchCount ? fmt.format(entry.branchCount) : "-"}</td>
        </tr>`;
    })
    .join("");
}

function renderEmployeeSlotDashboard(rows) {
  renderEmployeeSlotOverview(rows);
  renderEmployeeHeatmap(rows, "pick");
  renderEmployeeHeatmap(rows, "sort");
  renderRoleSlotEmployeeTable(rows, "pick");
  renderRoleSlotEmployeeTable(rows, "sort");
  renderEmployeeSlots(rows);
}

function roleWorkMinutesForRows(rows, mode) {
  const timeKey = mode === "pick" ? "pick" : "sort";
  const workerKey = mode === "pick" ? "picker" : "sorter";
  let activeMinutes = 0;
  groupBy(rowsForRole(rows, mode), (row) => row[workerKey].code).forEach((workerRows) => {
    groupBy(workerRows, (row) => rowDate(row, mode)).forEach((dayRows) => {
      activeMinutes += roleActiveMinutes(dayRows, mode, timeKey);
    });
  });
  return activeMinutes;
}

function productKey(row) {
  return row.productCode || row.item || "(ไม่มีรหัสสินค้า)";
}

function productTitle(row) {
  return row.productName || row.productCode || row.item || "-";
}

function productSummary(rows, mode = state.peopleMode) {
  return [...groupBy(rowsForRole(rows, mode), productKey).entries()]
    .map(([code, items]) => {
      const waves = new Set(items.map((row) => row.wave).filter(Boolean));
      const branches = new Set(items.map((row) => row.branch).filter(Boolean));
      const workers = new Set(items.map((row) => roleWorker(row, mode).code).filter(Boolean));
      const workMinutes = roleWorkMinutesForRows(items, mode);
      const activeHours = workMinutes / 60;
      const qtyEach = sumBy(items, "qtyEach");
      const qtyPack = sumBy(items, "qtyPack");
      const waveCount = waves.size;
      return {
        code,
        name: productTitle(items.find((row) => row.productName) || items[0]),
        qtyEach,
        qtyPack,
        rowCount: items.length,
        waveCount,
        branchCount: branches.size,
        workerCount: workers.size,
        workMinutes,
        activeHours,
        avgMinutesPerRow: items.length ? workMinutes / items.length : null,
        avgMinutesPerWave: waveCount ? workMinutes / waveCount : null,
        qtyPerWave: waveCount ? qtyEach / waveCount : null,
        packPerHour: activeHours ? qtyPack / activeHours : null,
      };
    })
    .sort((a, b) => b.qtyEach - a.qtyEach || b.rowCount - a.rowCount || a.code.localeCompare(b.code));
}

function productWaveSummary(rows, mode = state.peopleMode) {
  const roleRows = rowsForRole(rows, mode);
  const groups = groupBy(roleRows, (row) => `${row.wave || "(ไม่มี Wave)"}|${productKey(row)}`);
  return [...groups.entries()]
    .map(([, items]) => {
      const first = items[0];
      const branches = new Set(items.map((row) => row.branch).filter(Boolean));
      const workers = new Set(items.map((row) => roleWorker(row, mode).code).filter(Boolean));
      const workMinutes = roleWorkMinutesForRows(items, mode);
      const activeHours = workMinutes / 60;
      const qtyEach = sumBy(items, "qtyEach");
      const qtyPack = sumBy(items, "qtyPack");
      return {
        wave: first.wave || "(ไม่มี Wave)",
        date: rowDate(first, mode),
        code: productKey(first),
        name: productTitle(items.find((row) => row.productName) || first),
        qtyEach,
        qtyPack,
        rowCount: items.length,
        branchCount: branches.size,
        workerCount: workers.size,
        workMinutes,
        activeHours,
        avgMinutesPerRow: items.length ? workMinutes / items.length : null,
        packPerHour: activeHours ? qtyPack / activeHours : null,
      };
    })
    .sort((a, b) => b.qtyEach - a.qtyEach || a.wave.localeCompare(b.wave) || a.code.localeCompare(b.code));
}

function renderProductItems(rows) {
  const mode = activeMode();
  const label = roleLabel(mode);
  const roleRows = rowsForRole(rows, mode);
  const products = productSummary(rows, mode);
  const productWaves = productWaveSummary(rows, mode);
  const overview = roleWorkTimeSummary(rows, mode);
  const totalQty = sumBy(roleRows, "qtyEach");
  const totalPack = sumBy(roleRows, "qtyPack");
  const avgProductWaveMinutes = productWaves.length
    ? productWaves.reduce((sum, entry) => sum + entry.workMinutes, 0) / productWaves.length
    : null;

  const overviewHint = $("#productOverviewHint");
  if (overviewHint) {
    overviewHint.textContent = `${label} · ${fmt.format(products.length)} สินค้า · ${fmt.format(productWaves.length)} แถวสินค้า/Wave`;
  }

  const kpiGrid = $("#productKpis");
  if (kpiGrid) {
    const cards = [
      ["cyan", "สินค้า", fmt.format(products.length), `${fmt.format(roleRows.length)} รายการ ${label}`],
      ["green", "ยอดชิ้นรวม", fmt.format(totalQty), `${fmt.format(totalPack)} แพ็ค`],
      ["amber", "เฉลี่ยเวลา / 1 Wave", metricMinutes(avgProductWaveMinutes), `${fmt.format(productWaves.length)} แถวสินค้า/Wave`],
      ["rose", "แพ็ค / ชั่วโมง", overview.activeHours ? `${fmt1.format(totalPack / overview.activeHours)} แพ็ค/hr` : "-", `${fmt1.format(overview.activeHours)} ชม.รวม`],
    ];
    kpiGrid.innerHTML = cards
      .map(([tone, title, value, note]) => `
        <article class="insight-card ${tone}">
          <span>${html(title)}</span>
          <strong>${html(value)}</strong>
          <small>${html(note)}</small>
        </article>`)
      .join("");
  }

  const productHint = $("#productTableHint");
  if (productHint) productHint.textContent = `Top ${fmt.format(Math.min(products.length, 80))} ตามยอดชิ้น`;
  const productTable = $("#productTable");
  if (productTable) {
    if (!products.length) {
      productTable.innerHTML = `<tr><td colspan="12" class="empty">ไม่มีข้อมูลสินค้า</td></tr>`;
    } else {
      const maxQty = Math.max(...products.map((entry) => entry.qtyEach), 1);
      productTable.innerHTML = products.slice(0, 80).map((entry) => {
        const pct = (entry.qtyEach / maxQty) * 100;
        return `
          <tr>
            <td><span class="tag">${html(entry.code)}</span></td>
            <td>
              <div class="product-name-cell">
                <strong>${html(entry.name)}</strong>
                <small>${html(entry.code)}</small>
              </div>
            </td>
            <td class="num">
              <div class="employee-slot-total">
                <strong>${fmt.format(entry.qtyEach)}</strong>
                <span><i style="width:${pct}%"></i></span>
              </div>
            </td>
            <td class="num">${fmt.format(entry.qtyPack)}</td>
            <td class="num">${fmt.format(entry.rowCount)}</td>
            <td class="num">${fmt.format(entry.waveCount)}</td>
            <td class="num">${fmt.format(entry.branchCount)}</td>
            <td class="num">${fmt.format(entry.workerCount)}</td>
            <td class="num">${metricMinutes(entry.workMinutes)}</td>
            <td class="num">${metricMinutes(entry.avgMinutesPerRow)}</td>
            <td class="num">${metricMinutes(entry.avgMinutesPerWave)}</td>
            <td class="num">${entry.packPerHour ? fmt1.format(entry.packPerHour) : "-"}</td>
          </tr>`;
      }).join("");
    }
  }

  const productWaveHint = $("#productWaveHint");
  if (productWaveHint) productWaveHint.textContent = `Top ${fmt.format(Math.min(productWaves.length, 120))} สินค้า/Wave`;
  const productWaveTable = $("#productWaveTable");
  if (productWaveTable) {
    if (!productWaves.length) {
      productWaveTable.innerHTML = `<tr><td colspan="12" class="empty">ไม่มีข้อมูลสินค้า/Wave</td></tr>`;
    } else {
      productWaveTable.innerHTML = productWaves.slice(0, 120).map((entry) => `
        <tr>
          <td><span class="tag tag-wave">${html(entry.wave)}</span></td>
          <td><span class="date-cell">${html(entry.date || "-")}</span></td>
          <td><span class="tag">${html(entry.code)}</span></td>
          <td>
            <div class="product-name-cell compact">
              <strong>${html(entry.name)}</strong>
            </div>
          </td>
          <td class="num">${fmt.format(entry.qtyEach)}</td>
          <td class="num">${fmt.format(entry.qtyPack)}</td>
          <td class="num">${fmt.format(entry.rowCount)}</td>
          <td class="num">${fmt.format(entry.branchCount)}</td>
          <td class="num">${fmt.format(entry.workerCount)}</td>
          <td class="num">${metricMinutes(entry.workMinutes)}</td>
          <td class="num">${metricMinutes(entry.avgMinutesPerRow)}</td>
          <td class="num">${entry.packPerHour ? fmt1.format(entry.packPerHour) : "-"}</td>
        </tr>`).join("");
    }
  }
}

function waveSummary(rows, mode = state.peopleMode) {
  return [...groupBy(rowsForRole(rows, mode), (row) => row.wave).entries()]
    .map(([wave, items]) => {
      const branches = new Set();
      for (const item of items) {
        if (item.branch) branches.add(item.branch);
      }
      const workMinutes = roleWorkMinutesForRows(items, mode);
      return {
        wave,
        date: rowDate(items[0], mode),
        qtyEach: sumBy(items, "qtyEach"),
        qtyPack: sumBy(items, "qtyPack"),
        rowCount: items.length,
        workMinutes,
        avgMinutesPerRow: items.length ? workMinutes / items.length : null,
        branchCount: branches.size,
      };
    })
    .sort((a, b) => b.qtyEach - a.qtyEach || b.qtyPack - a.qtyPack);
}

function renderWaves(rows) {
  const mode = activeMode();
  const label = roleLabel(mode);
  const waves = waveSummary(rows, mode).slice(0, 18);
  $("#waveHint").textContent = `${fmt.format(uniqueCount(rows, (row) => row.wave))} waves`;
  const head = $("#waveTable")?.closest("table")?.querySelector("thead");
  if (head) {
    head.innerHTML = `
      <tr>
        <th>Wave</th>
        <th>วันที่</th>
        <th class="num">ชิ้น</th>
        <th class="num">แพ็ค</th>
        <th class="num">สาขา</th>
        <th class="num">เวลา ${label}</th>
        <th class="num">เฉลี่ย/รายการ</th>
      </tr>`;
  }
  if (!waves.length) {
    $("#waveTable").innerHTML = `<tr><td colspan="7" class="empty">ไม่มีข้อมูล</td></tr>`;
    return;
  }
  const maxEach = Math.max(...waves.map(w => w.qtyEach), 1);
  const maxPack = Math.max(...waves.map(w => w.qtyPack), 1);
  $("#waveTable").innerHTML = waves.map((wave) => {
    const eachPct = (wave.qtyEach / maxEach) * 100;
    const packPct = (wave.qtyPack / maxPack) * 100;
    const avg = wave.avgMinutesPerRow;
    const avgClass = avg === null ? "" : avg <= 5 ? "cycle-fast" : avg <= 15 ? "cycle-mid" : "cycle-slow";
    const dateStr  = wave.date ? wave.date.slice(5).replace("-", "/") : "-";
    return `
      <tr>
        <td><span class="tag tag-wave">${html(wave.wave || "-")}</span></td>
        <td><span class="date-cell">${html(dateStr)}</span></td>
        <td class="num">
          <div class="pack-cell">
            <span>${fmt.format(wave.qtyEach)}</span>
            <div class="pack-bar-wrap"><div class="pack-bar pack-bar-each" style="width:${eachPct}%"></div></div>
          </div>
        </td>
        <td class="num">
          <div class="pack-cell">
            <span>${fmt.format(wave.qtyPack)}</span>
            <div class="pack-bar-wrap"><div class="pack-bar" style="width:${packPct}%"></div></div>
          </div>
        </td>
        <td class="num">${wave.branchCount ? fmt.format(wave.branchCount) : "-"}</td>
        <td class="num">${metricMinutes(wave.workMinutes)}</td>
        <td class="num"><span class="cycle-badge ${avgClass}">${metricMinutes(avg)}</span></td>
      </tr>`;
  }).join("");
}

function renderSlowRows(rows) {
  const mode = activeMode();
  const label = roleLabel(mode);
  const workerTitle = mode === "sort" ? "Sorter" : "Picker";
  const table = $("#slowTable");
  if (!table) return;
  const head = table?.closest("table")?.querySelector("thead");
  if (head) {
    head.innerHTML = `
      <tr>
        <th>Wave</th>
        <th>กะ</th>
        <th>วันที่</th>
        <th>Item</th>
        <th>สาขา</th>
        <th class="num">ชิ้น</th>
        <th class="num">แพ็ค</th>
        <th>${workerTitle}</th>
        <th>เวลา ${label}</th>
      </tr>`;
  }
  const sorted = rowsForRole(rows, mode)
    .sort((a, b) => roleTime(b, mode).at.localeCompare(roleTime(a, mode).at))
    .slice(0, 24);
  $("#slowHint").textContent = `เรียงจาก ${label} ล่าสุด`;
  if (!sorted.length) {
    table.innerHTML = `<tr><td colspan="9" class="empty">ไม่มีข้อมูล</td></tr>`;
    return;
  }
  table.innerHTML = sorted.map((row) => {
    const time = roleTime(row, mode);
    const worker = roleWorker(row, mode);
    const roleTimeText = [time.date ? time.date.slice(5).replace("-", "/") : "", time.time || ""].filter(Boolean).join(" ");
    const shift = roleShift(row, mode);
    return `
      <tr>
        <td><span class="tag tag-wave">${html(row.wave || "-")}</span></td>
        <td><span class="tag tag-${shift?.group || 'unknown'}">${html(shift?.shortLabel || "-")}</span></td>
        <td><span class="date-cell">${html(rowDate(row, mode) ? rowDate(row, mode).slice(5).replace("-","/") : "-")}</span></td>
        <td class="item-cell">${html(row.item || "-")}</td>
        <td><span class="tag tag-branch">${html(row.branch || "-")}</span></td>
        <td class="num"><strong>${fmt.format(row.qtyEach)}</strong></td>
        <td class="num">${fmt.format(row.qtyPack)}</td>
        <td>${displayWorkerCompact(worker)}</td>
        <td class="num time-cell">${html(roleTimeText || "-")}</td>
      </tr>`;
  }).join("");
}

function displayWorkerCompact(worker) {
  if (!worker || !worker.code) return '<span class="missing">-</span>';
  const label = workerDisplayName(worker);
  return `<span class="worker-compact"><strong>${html(label)}</strong> <small>${html(worker.code)}</small></span>`;
}

function renderBranchesView(rows) {
  const mode = activeMode();
  const roleRows = rowsForRole(rows, mode);
  const branchRows = roleRows.filter((r) => r.branch);
  const totalQtyEach = sumBy(roleRows, "qtyEach");
  
  const uniqueBranches = new Set(roleRows.map((r) => r.branch).filter(Boolean));
  const totalBranchesCount = uniqueBranches.size;

  const days = new Set(roleRows.map((row) => rowDate(row, mode)).filter(Boolean));
  const waves = new Set(roleRows.map((r) => r.wave).filter(Boolean));
  
  const avgBranchesPerDay = days.size ? totalBranchesCount / days.size : 0;
  const avgBranchesPerWave = waves.size ? totalBranchesCount / waves.size : 0;

  const branchStatsMap = new Map();
  roleRows.forEach((row) => {
    if (!row.branch) return;
    if (!branchStatsMap.has(row.branch)) {
      branchStatsMap.set(row.branch, { branch: row.branch, qtyEach: 0, qtyPack: 0, waves: new Set() });
    }
    const stat = branchStatsMap.get(row.branch);
    stat.qtyEach += row.qtyEach || 0;
    stat.qtyPack += row.qtyPack || 0;
    if (row.wave) stat.waves.add(row.wave);
  });
  
  const branchStatsList = [...branchStatsMap.values()]
    .map(stat => ({ ...stat, waveCount: stat.waves.size }))
    .sort((a, b) => b.qtyEach - a.qtyEach);

  const topBranchObj = branchStatsList[0] || { branch: "-", qtyEach: 0 };

  const kpiContainer = $("#branchKpiGrid");
  if (kpiContainer) {
    const kpis = [
      {
        color: "teal",
        label: "สาขาทั้งหมด",
        value: fmt.format(totalBranchesCount),
        note: `จากทั้งหมด ${fmt.format(roleRows.length)} รายการ ${roleLabel(mode)}`,
      },
      {
        color: "indigo",
        label: "จำนวนสาขา / วัน",
        value: `${fmt1.format(avgBranchesPerDay)} สาขา`,
        note: `เฉลี่ยจากทั้งหมด ${fmt.format(days.size)} วัน`,
      },
      {
        color: "amber",
        label: "จำนวนสาขา / Wave",
        value: `${fmt1.format(avgBranchesPerWave)} สาขา`,
        note: `เฉลี่ยจากทั้งหมด ${fmt.format(waves.size)} Wave`,
      },
      {
        color: "cyan",
        label: "สาขาที่จ่ายงานมากสุด",
        value: topBranchObj.branch,
        note: `จ่ายไป ${fmt.format(topBranchObj.qtyEach)} ชิ้น (${fmt.format(topBranchObj.qtyPack || 0)} แพ็ค)`,
      }
    ];

    kpiContainer.innerHTML = kpis
      .map(
        ({ color, label, value, note }) => `
          <article class="kpi ${color}">
            <span>${html(label)}</span>
            <strong>${html(value)}</strong>
            <small>${html(note)}</small>
          </article>`
      )
      .join("");
  }

  const hint = $("#branchHint");
  if (hint) hint.textContent = `${fmt.format(totalBranchesCount)} สาขาที่กำลังให้บริการ`;

  const topBranchesTable = $("#topBranchesTable");
  if (topBranchesTable) {
    const displayList = branchStatsList.slice(0, 15);
    if (!displayList.length) {
      topBranchesTable.innerHTML = `<tr><td colspan="5" class="empty">ไม่มีข้อมูล</td></tr>`;
    } else {
      const maxQty = Math.max(...displayList.map(b => b.qtyEach), 1);
      topBranchesTable.innerHTML = displayList
        .map((b) => {
          const pct = totalQtyEach ? (b.qtyEach / totalQtyEach) * 100 : 0;
          const barPct = (b.qtyEach / maxQty) * 100;
          return `
            <tr>
              <td><span class="tag tag-branch">${html(b.branch)}</span></td>
              <td class="num">
                <div class="pack-cell">
                  <span>${fmt.format(b.qtyEach)}</span>
                  <div class="pack-bar-wrap"><div class="pack-bar pack-bar-each" style="width:${barPct}%"></div></div>
                </div>
              </td>
              <td class="num">${fmt.format(b.qtyPack)}</td>
              <td class="num">${fmt.format(b.waveCount)}</td>
              <td class="num">${fmt1.format(pct)}%</td>
            </tr>`;
        })
        .join("");
    }
  }

  const dailyBranchesTable = $("#dailyBranchesTable");
  if (dailyBranchesTable) {
    const groupsByDate = new Map();
    roleRows.forEach((r) => {
      const date = rowDate(r, mode);
      if (!date) return;
      if (!groupsByDate.has(date)) groupsByDate.set(date, []);
      groupsByDate.get(date).push(r);
    });

    const dates = [...groupsByDate.keys()].sort((a, b) => a.localeCompare(b));
    if (!dates.length) {
      dailyBranchesTable.innerHTML = `<tr><td colspan="4" class="empty">ไม่มีข้อมูล</td></tr>`;
    } else {
      dailyBranchesTable.innerHTML = dates
        .map((date) => {
          const items = groupsByDate.get(date) || [];
          const dayBranches = new Set(items.filter((x) => roleShift(x, mode)?.group === "day").map((x) => x.branch).filter(Boolean)).size;
          const nightBranches = new Set(items.filter((x) => roleShift(x, mode)?.group === "night").map((x) => x.branch).filter(Boolean)).size;
          const totalBranches = new Set(items.map((x) => x.branch).filter(Boolean)).size;
          return `
            <tr>
              <td>${html(date)}</td>
              <td class="num">${dayBranches ? fmt.format(dayBranches) : "-"}</td>
              <td class="num">${nightBranches ? fmt.format(nightBranches) : "-"}</td>
              <td class="num"><strong>${totalBranches ? fmt.format(totalBranches) : "-"}</strong></td>
            </tr>`;
        })
        .join("");
    }
  }

  const slotBranchesTable = $("#slotBranchesTable");
  if (slotBranchesTable) {
    const slots = Array.from({ length: 24 }, (_, hour) => ({
      key: `${hour}`.padStart(2, "0"),
      label: `${hour}`.padStart(2, "0") + ":00",
      branches: new Set(),
    }));
    const bySlot = new Map(slots.map((s) => [s.key, s]));
    roleRows.forEach((row) => {
      const time = roleTime(row, mode);
      if (time?.slotKey && bySlot.has(time.slotKey) && row.branch) {
        bySlot.get(time.slotKey).branches.add(row.branch);
      }
    });
    const visibleSlots = slots.filter((s) => s.branches.size > 0);
    const maxBranches = Math.max(...visibleSlots.map(s => s.branches.size), 1);

    if (!visibleSlots.length) {
      slotBranchesTable.innerHTML = `<tr><td colspan="3" class="empty">ไม่มีข้อมูล</td></tr>`;
    } else {
      slotBranchesTable.innerHTML = visibleSlots
        .map((s) => {
          const count = s.branches.size;
          const pct = (count / maxBranches) * 100;
          return `
            <tr>
              <td><span class="tag">${s.label}</span></td>
              <td>
                <div class="bar-track" style="margin: 0; width: 100%; min-width: 100px;">
                  <div class="bar-pair">
                    <div class="bar-pick" style="width:${pct}%"></div>
                  </div>
                </div>
              </td>
              <td class="num"><strong>${fmt.format(count)}</strong></td>
            </tr>`;
        })
        .join("");
    }
  }

  const waveBranchesTable = $("#waveBranchesTable");
  if (waveBranchesTable) {
    const wavesList = [...groupBy(roleRows, (r) => r.wave).entries()]
      .map(([wave, items]) => {
        const branches = new Set(items.map(r => r.branch).filter(Boolean));
        return {
          wave,
          date: rowDate(items[0], mode),
          qtyEach: sumBy(items, "qtyEach"),
          qtyPack: sumBy(items, "qtyPack"),
          branchCount: branches.size,
        };
      })
      .sort((a, b) => b.qtyEach - a.qtyEach)
      .slice(0, 15);

    if (!wavesList.length) {
      waveBranchesTable.innerHTML = `<tr><td colspan="5" class="empty">ไม่มีข้อมูล</td></tr>`;
    } else {
      waveBranchesTable.innerHTML = wavesList
        .map((w) => `
          <tr>
            <td><span class="tag tag-wave">${html(w.wave)}</span></td>
            <td><span class="date-cell">${html(w.date ? w.date.slice(5).replace("-","/") : "-")}</span></td>
            <td class="num">${fmt.format(w.qtyEach)}</td>
            <td class="num">${fmt.format(w.qtyPack)}</td>
            <td class="num"><strong>${fmt.format(w.branchCount)}</strong></td>
          </tr>`)
        .join("");
    }
  }
}

function xmlEscape(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function excelCell(value, isHeader = false) {
  const type = typeof value === "number" && Number.isFinite(value) ? "Number" : "String";
  const style = isHeader ? ' ss:StyleID="header"' : "";
  return `<Cell${style}><Data ss:Type="${type}">${xmlEscape(value)}</Data></Cell>`;
}

function safeSheetName(name, usedNames = new Set()) {
  const base = String(name || "Sheet")
    .replace(/[\\/?*:[\]]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 31) || "Sheet";
  let next = base;
  let index = 2;
  while (usedNames.has(next)) {
    const suffix = ` ${index}`;
    next = `${base.slice(0, 31 - suffix.length)}${suffix}`;
    index += 1;
  }
  usedNames.add(next);
  return next;
}

function worksheetXml(sheet, usedNames) {
  const name = safeSheetName(sheet.name, usedNames);
  const rows = sheet.rows?.length ? sheet.rows : [["ไม่มีข้อมูล"]];
  const rowXml = rows
    .map((row, rowIndex) => `<Row>${row.map((cell) => excelCell(cell, rowIndex === 0)).join("")}</Row>`)
    .join("");
  return `<Worksheet ss:Name="${xmlEscape(name)}"><Table ss:DefaultColumnWidth="118">${rowXml}</Table></Worksheet>`;
}

function saveExcelWorkbook(sheets, filename) {
  const usedNames = new Set();
  const workbook = `<?xml version="1.0" encoding="UTF-8"?>
<?mso-application progid="Excel.Sheet"?>
<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet"
 xmlns:o="urn:schemas-microsoft-com:office:office"
 xmlns:x="urn:schemas-microsoft-com:office:excel"
 xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">
  <Styles>
    <Style ss:ID="header">
      <Font ss:Bold="1" ss:Color="#FFFFFF"/>
      <Interior ss:Color="#1F4E78" ss:Pattern="Solid"/>
    </Style>
  </Styles>
  ${sheets.map((sheet) => worksheetXml(sheet, usedNames)).join("")}
</Workbook>`;
  const blob = new Blob([workbook], { type: "application/vnd.ms-excel;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename.endsWith(".xls") ? filename : `${filename}.xls`;
  link.click();
  URL.revokeObjectURL(url);
}

function exportTimestamp() {
  const dt = new Date();
  return [
    dt.getFullYear(),
    pad2(dt.getMonth() + 1),
    pad2(dt.getDate()),
    "-",
    pad2(dt.getHours()),
    pad2(dt.getMinutes()),
  ].join("");
}

function menuLabel(menu = state.activeMenu) {
  return {
    overview: "ภาพรวม",
    daily: "รายวัน",
    people: "พนักงาน-Wave",
    employeeSlots: "คน-เวลา",
    products: "รายการสินค้า",
    worklist: "รายการ",
  }[menu] || menu;
}

function exportInfoRows(rowCount) {
  return [
    ["หัวข้อ", "ค่า"],
    ["เมนู", menuLabel()],
    ["โหมด", roleLabel()],
    ["เริ่มวันที่", state.dateFrom || "-"],
    ["ถึงวันที่", state.dateTo || "-"],
    ["เดือน", state.activeMenu === "daily" ? state.monthFilter || "-" : "-"],
    ["กะ", SHIFT_FILTERS[state.shiftFilter] || state.shiftFilter || "ทั้งหมด"],
    ["ค้นหา", state.search || "-"],
    ["จำนวนแถวข้อมูล", rowCount],
    ["Export เมื่อ", formatThaiDateTime(new Date())],
  ];
}

function overviewExcelSheets(rows, prevRows) {
  const mode = activeMode();
  const roleRows = rowsForRole(rows, mode);
  const qtyRows = roleRows;
  const prod = calculateRoleProductivity(rows, mode);
  const sorted = roleRows.filter((row) => row.sort.at).length;
  const sortRate = roleRows.length ? (sorted / roleRows.length) * 100 : 0;
  const summaryRows = [
    ["Metric", "Value"],
    ["Mode", roleLabel()],
    ["Qty ชิ้น", sumBy(qtyRows, "qtyEach")],
    ["Qty แพ็ค", sumBy(qtyRows, "qtyPack")],
    [`รายการ ${roleLabel()}`, qtyRows.length],
    ["คน", uniqueCount(roleRows, (row) => roleWorker(row, mode).code)],
    ["Items", uniqueCount(qtyRows, (row) => row.item)],
    ["Waves", uniqueCount(qtyRows, (row) => row.wave)],
    ["Sort สำเร็จ %", sortRate],
    ["Productivity แพ็ค/hr", prod.productivity],
    ["Active hours", prod.totalActiveHours],
  ];

  const dayNightRows = [
    ["Shift", "Qty ชิ้น", "Qty แพ็ค", "รายการ", "คน", `${roleLabel(mode)} เฉลี่ย นาที/รายการ`],
    ...["day", "night", "transition"].map((group) => {
      const items = roleRows.filter((row) => roleShift(row, mode)?.group === group);
      const workTime = roleWorkTimeSummary(items, mode);
      return [
        group,
        sumBy(items, "qtyEach"),
        sumBy(items, "qtyPack"),
        items.length,
        uniqueCount(items, (row) => roleWorker(row, mode).code),
        workTime.avgMinutesPerRow || "",
      ];
    }),
  ];

  const previousRows = [
    ["Metric", "Current", "Previous"],
    ["Qty ชิ้น", sumBy(roleRows, "qtyEach"), sumBy(rowsForRole(prevRows, mode), "qtyEach")],
    ["Qty แพ็ค", sumBy(roleRows, "qtyPack"), sumBy(rowsForRole(prevRows, mode), "qtyPack")],
    ["รายการ", roleRows.length, rowsForRole(prevRows, mode).length],
  ];

  return [
    { name: "Summary", rows: summaryRows },
    { name: "Day Night", rows: dayNightRows },
    { name: "Compare", rows: previousRows },
  ];
}

function dailyDayNightRows(rows) {
  const mode = activeMode();
  const roleRows = rowsForRole(rows, mode);
  const groupsByDate = groupBy(roleRows, (row) => rowDate(row, mode));
  const dates = [...groupsByDate.keys()].sort((a, b) => a.localeCompare(b));
  return [
    ["วันที่", "DAY ชิ้น", "DAY แพ็ค", "NIGHT ชิ้น", "NIGHT แพ็ค", "อื่นๆ ชิ้น", "อื่นๆ แพ็ค", "รวมชิ้น", "รวมแพ็ค", "DAY %", "NIGHT %"],
    ...dates.map((date) => {
      const items = groupsByDate.get(date) || [];
      const day = items.filter((row) => roleShift(row, mode)?.group === "day");
      const night = items.filter((row) => roleShift(row, mode)?.group === "night");
      const other = items.filter((row) => !["day", "night"].includes(roleShift(row, mode)?.group || ""));
      const totalEach = sumBy(items, "qtyEach");
      return [
        date,
        sumBy(day, "qtyEach"),
        sumBy(day, "qtyPack"),
        sumBy(night, "qtyEach"),
        sumBy(night, "qtyPack"),
        sumBy(other, "qtyEach"),
        sumBy(other, "qtyPack"),
        totalEach,
        sumBy(items, "qtyPack"),
        totalEach ? (sumBy(day, "qtyEach") / totalEach) * 100 : 0,
        totalEach ? (sumBy(night, "qtyEach") / totalEach) * 100 : 0,
      ];
    }),
  ];
}

function dailyShiftSummaryRows(rows) {
  return [
    ["กะ", "ช่วงเวลาปกติ", "ช่วงเวลา OT", "Qty ชิ้น", "Qty แพ็ค", "รายการ", "คน", "สาขา", "เวลารวม ชั่วโมง", "OT ชั่วโมง", "Productivity แพ็ค/hr"],
    ...dailyShiftSummary(rows, activeMode()).map((summary) => [
      `${summary.label} ${summary.shortLabel}`,
      summary.window,
      summary.otWindow,
      summary.qtyEach,
      summary.qtyPack,
      summary.rowCount,
      summary.workers,
      summary.branches,
      summary.totalHours,
      summary.otHours,
      summary.productivity || "",
    ]),
  ];
}

function dailyExcelSheets(rows) {
  const mode = activeMode();
  const label = roleLabel(mode);
  return [
    { name: "Shift Summary", rows: dailyShiftSummaryRows(rows) },
    { name: "Day Night", rows: dailyDayNightRows(rows) },
    {
      name: "Daily Trend",
      rows: [
        ["วันที่", "Qty ชิ้น", "Qty แพ็ค", `${label} เฉลี่ย นาที/รายการ`],
        ...dailySummary(rows, mode).map((day) => [day.date, day.qtyEach, day.qtyPack, day.avgCycle || ""]),
      ],
    },
  ];
}

function employeeSlotExcelRows(rows) {
  return [
    ["Slot", "รหัส", "ชื่อจริง", "จำนวนวัน", "Pick ชิ้น", "Pick แพ็ค", "Pick รายการ", "Pick เวลางาน นาที", "Pick เฉลี่ย นาที/รายการ", "Pick สาขา", "Sort ชิ้น", "Sort แพ็ค", "Sort รายการ", "Sort เวลางาน นาที", "Sort เฉลี่ย นาที/รายการ", "Sort สาขา", "สาขารวม", "รวมชิ้น", "รวมรายการ"],
    ...employeeSlotSummary(rows).map((entry) => [
      entry.slotLabel,
      entry.worker.code,
      workerDisplayName(entry.worker),
      entry.dayCount,
      entry.pickQtyEach,
      entry.pickQtyPack,
      entry.pickRows,
      entry.pickWorkMinutes,
      entry.pickAvgMinutes || "",
      entry.pickBranchCount,
      entry.sortQtyEach,
      entry.sortQtyPack,
      entry.sortRows,
      entry.sortWorkMinutes,
      entry.sortAvgMinutes || "",
      entry.sortBranchCount,
      entry.branchCount,
      entry.totalQtyEach,
      entry.totalRows,
    ]),
  ];
}

function roleEmployeeSlotExcelRows(rows, mode) {
  return [
    ["Slot", "รหัส", "ชื่อจริง", "Qty ชิ้น", "Qty แพ็ค", "รายการ", "เวลางาน นาที", "เฉลี่ย นาที/รายการ", "จำนวนวัน", "จำนวนสาขา"],
    ...roleEmployeeSlotSummary(rows, mode).map((entry) => [
      entry.slotLabel,
      entry.worker.code,
      workerDisplayName(entry.worker),
      entry.qtyEach,
      entry.qtyPack,
      entry.rowCount,
      entry.workMinutes,
      entry.avgMinutesPerRow || "",
      entry.dayCount,
      entry.branchCount,
    ]),
  ];
}

function employeeSlotExcelSheets(rows) {
  const mode = activeMode();
  const label = roleLabel(mode);
  const entries = roleEmployeeSlotSummary(rows, mode);
  const roleTime = roleWorkTimeSummary(rows, mode);
  const summaryRows = [
    ["Metric", "Value"],
    ["Mode", label],
    ["คนที่มีงาน", new Set(entries.map((entry) => entry.worker.code).filter(Boolean)).size],
    ["Slot ที่มีงาน", new Set(entries.map((entry) => entry.slotKey).filter(Boolean)).size],
    [`${label} Qty ชิ้น`, entries.reduce((sum, entry) => sum + entry.qtyEach, 0)],
    [`${label} เวลารวม ชั่วโมง`, roleTime.activeHours],
    [`${label} เฉลี่ย นาที/รายการ`, roleTime.avgMinutesPerRow || ""],
    [`Peak ${label} Slot`, peakSlotLabel(entries)],
  ];

  return [
    { name: "Summary", rows: summaryRows },
    { name: `${label} Slot People`, rows: roleEmployeeSlotExcelRows(rows, mode) },
  ];
}

function productExcelSheets(rows) {
  const mode = activeMode();
  const products = productSummary(rows, mode);
  const productWaves = productWaveSummary(rows, mode);
  const overview = roleWorkTimeSummary(rows, mode);
  const roleRows = rowsForRole(rows, mode);
  const totalQty = sumBy(roleRows, "qtyEach");
  const totalPack = sumBy(roleRows, "qtyPack");
  const productWaveMinutes = productWaves.reduce((sum, entry) => sum + entry.workMinutes, 0);
  return [
    {
      name: "Summary",
      rows: [
        ["Metric", "Value"],
        ["Mode", roleLabel(mode)],
        ["สินค้า", products.length],
        ["รายการ", roleRows.length],
        ["Qty ชิ้น", totalQty],
        ["Qty แพ็ค", totalPack],
        ["เวลารวม ชั่วโมง", overview.activeHours],
        ["เฉลี่ย นาที/รายการ", overview.avgMinutesPerRow || ""],
        ["เฉลี่ย นาที/สินค้า-Wave", productWaves.length ? productWaveMinutes / productWaves.length : ""],
        ["แพ็ค/ชั่วโมง", overview.activeHours ? totalPack / overview.activeHours : ""],
      ],
    },
    {
      name: "Products",
      rows: [
        ["รหัสสินค้า", "ชื่อสินค้า", "Qty ชิ้น", "Qty แพ็ค", "รายการ", "Wave", "สาขา", "คน", "เวลารวม นาที", "เฉลี่ย นาที/รายการ", "เฉลี่ย นาที/1 Wave", "แพ็ค/ชั่วโมง", "ชิ้น/Wave"],
        ...products.map((entry) => [
          entry.code,
          entry.name,
          entry.qtyEach,
          entry.qtyPack,
          entry.rowCount,
          entry.waveCount,
          entry.branchCount,
          entry.workerCount,
          entry.workMinutes,
          entry.avgMinutesPerRow || "",
          entry.avgMinutesPerWave || "",
          entry.packPerHour || "",
          entry.qtyPerWave || "",
        ]),
      ],
    },
    {
      name: "Product Wave",
      rows: [
        ["Wave", "วันที่", "รหัสสินค้า", "ชื่อสินค้า", "Qty ชิ้น", "Qty แพ็ค", "รายการ", "สาขา", "คน", "เวลางาน นาที", "เฉลี่ย นาที/รายการ", "แพ็ค/ชั่วโมง"],
        ...productWaves.map((entry) => [
          entry.wave,
          entry.date,
          entry.code,
          entry.name,
          entry.qtyEach,
          entry.qtyPack,
          entry.rowCount,
          entry.branchCount,
          entry.workerCount,
          entry.workMinutes,
          entry.avgMinutesPerRow || "",
          entry.packPerHour || "",
        ]),
      ],
    },
  ];
}

function peopleExcelSheets(rows) {
  const mode = activeMode();
  const label = roleLabel(mode);
  return [
    {
      name: `${roleLabel()} People`,
      rows: [
        ["รหัส", "ชื่อจริง", "Qty ชิ้น", "Qty แพ็ค", "รายการ", "Wave", "จำนวนสาขา", "เวลารวม ชั่วโมง", "เฉลี่ย นาที/รายการ"],
        ...employeeSummary(rows, mode).map((person) => [
          person.worker.code,
          workerDisplayName(person.worker),
          person.qtyEach,
          person.qtyPack,
          person.rowCount,
          person.waves,
          person.branchCount,
          person.activeHours,
          person.avgWorkMinutes || "",
        ]),
      ],
    },
    {
      name: `${roleLabel()} Slot`,
      rows: [
        ["เวลา", "รายการ", "Qty ชิ้น", "Qty แพ็ค", "จำนวนสาขา"],
        ...slotSummary(rows, mode).map((slot) => [slot.label, slot.count, slot.qtyEach, slot.qtyPack, slot.branchCount]),
      ],
    },
    {
      name: "Wave",
      rows: [
        ["Wave", "วันที่", "Qty ชิ้น", "Qty แพ็ค", "จำนวนสาขา", `${label} เวลางาน นาที`, `${label} เฉลี่ย นาที/รายการ`],
        ...waveSummary(rows, mode).map((wave) => [
          wave.wave,
          wave.date,
          wave.qtyEach,
          wave.qtyPack,
          wave.branchCount,
          wave.workMinutes || "",
          wave.avgMinutesPerRow || "",
        ]),
      ],
    },
  ];
}

function worklistExcelSheets(rows) {
  const mode = activeMode();
  const label = roleLabel(mode);
  const workerLabel = mode === "sort" ? "Sorter" : "Picker";
  const sorted = rowsForRole(rows, mode).sort((a, b) => (roleTime(b, mode)?.at || "").localeCompare(roleTime(a, mode)?.at || ""));
  return [
    {
      name: "Worklist",
      rows: [
        ["Mode", "Wave", "วันที่", "กะ", "ช่วงเวลา", "Item", "รหัสสินค้า", "ชื่อสินค้า", "สาขา", "Qty ชิ้น", "Qty แพ็ค", `${workerLabel} code`, `${workerLabel} name`, `${label} date`, `${label} time`, `${label} slot`],
        ...sorted.map((row) => {
          const shift = roleShift(row, mode);
          const worker = roleWorker(row, mode);
          const time = roleTime(row, mode);
          return [
            label,
            row.wave,
            rowDate(row, mode),
            shift?.label || "",
            shift?.window || "",
            row.item,
            row.productCode || "",
            row.productName || "",
            row.branch || "",
            row.qtyEach,
            row.qtyPack,
            worker.code,
            workerDisplayName(worker),
            time.date,
            time.time,
            time.slot,
          ];
        }),
      ],
    },
  ];
}

function branchesExcelSheets(rows) {
  const mode = activeMode();
  const roleRows = rowsForRole(rows, mode);
  const topBranches = [...groupBy(roleRows, (r) => r.branch).entries()]
    .map(([branch, items]) => ({
      branch: branch || "ไม่ระบุ",
      qtyEach: sumBy(items, "qtyEach"),
      qtyPack: sumBy(items, "qtyPack"),
      waves: uniqueCount(items, (row) => row.wave),
    }))
    .sort((a, b) => b.qtyEach - a.qtyEach);

  const dailyGroups = groupBy(roleRows, (row) => rowDate(row, mode));
  const dailyDates = [...dailyGroups.keys()].sort((a, b) => a.localeCompare(b));
  const dailyBranches = dailyDates.map((date) => {
    const items = dailyGroups.get(date) || [];
    const day = new Set(items.filter((x) => roleShift(x, mode)?.group === "day").map((x) => x.branch).filter(Boolean)).size;
    const night = new Set(items.filter((x) => roleShift(x, mode)?.group === "night").map((x) => x.branch).filter(Boolean)).size;
    const total = new Set(items.map((x) => x.branch).filter(Boolean)).size;
    return [date, day, night, total];
  });

  return [
    {
      name: "Top Branches",
      rows: [
        ["รหัสสาขา", "Qty ชิ้น", "Qty แพ็ค", "จำนวน Wave"],
        ...topBranches.map((b) => [b.branch, b.qtyEach, b.qtyPack, b.waves]),
      ],
    },
    {
      name: "Daily Branches",
      rows: [
        ["วันที่", "DAY (สาขา)", "NIGHT (สาขา)", "รวม (สาขา)"],
        ...dailyBranches,
      ],
    },
  ];
}

function exportCurrentMenuExcel() {
  const activeRows = filteredRecords();
  const menuRows = state.activeMenu === "daily" ? filteredDailyRecords() : activeRows;
  const prevRows = previousPeriodRecords();
  const sheets = [{ name: "Info", rows: exportInfoRows(menuRows.length) }];

  if (state.activeMenu === "overview") {
    sheets.push(...overviewExcelSheets(activeRows, prevRows));
  } else if (state.activeMenu === "daily") {
    sheets.push(...dailyExcelSheets(menuRows));
  } else if (state.activeMenu === "people") {
    sheets.push(...peopleExcelSheets(activeRows));
  } else if (state.activeMenu === "employeeSlots") {
    sheets.push(...employeeSlotExcelSheets(activeRows));
  } else if (state.activeMenu === "products") {
    sheets.push(...productExcelSheets(activeRows));
  } else if (state.activeMenu === "branches") {
    sheets.push(...branchesExcelSheets(activeRows));
  } else if (state.activeMenu === "worklist") {
    sheets.push(...worklistExcelSheets(activeRows));
  } else {
    sheets.push(...worklistExcelSheets(activeRows));
  }

  const filename = `pick-to-sort-${state.activeMenu}-${activeMode()}-${exportTimestamp()}.xls`;
  saveExcelWorkbook(sheets, filename);
}

function renderQuality(rows) {
  const notCounted = rows.filter((row) => row.countedQty === false);
  const missingPick = rows.filter((row) => !row.pick.at);
  const missingSort = rows.filter((row) => !row.sort.at);
  const missingPicker = rows.filter((row) => !row.picker.code);
  const missingSorter = rows.filter((row) => !row.sorter.code);
  const noShift = rows.filter((row) => !row.shift || row.shift.group === "unknown" || row.shift.group === "unassigned");
  const countedRows = rows.filter((row) => row.countedQty !== false);
  const totalRawQtyEach = sumBy(rows, "rawQtyEach");
  const totalRawQtyPack = sumBy(rows, "rawQtyPack");
  const countedQtyEach = sumBy(countedRows, "qtyEach");
  const countedQtyPack = sumBy(countedRows, "qtyPack");
  const cutQtyEach = sumBy(notCounted, "rawQtyEach");
  const cutQtyPack = sumBy(notCounted, "rawQtyPack");

  const hint = $("#qualityHint");
  if (hint) hint.textContent = `${fmt.format(rows.length)} แถวในช่วงที่กรอง`;

  const cards = [
    ["green", "ยอดที่นับจริง", fmt.format(countedQtyEach), `${fmt.format(countedQtyPack)} แพ็ค จาก ${fmt.format(countedRows.length)} แถว`],
    ["rose", "ตัดออกเพราะ Not Picked", fmt.format(cutQtyEach), `${fmt.format(cutQtyPack)} แพ็ค จาก ${fmt.format(notCounted.length)} แถว`],
    ["cyan", "ยอดดิบก่อนตัด", fmt.format(totalRawQtyEach), `${fmt.format(totalRawQtyPack)} แพ็ค`],
    ["amber", "ยังไม่มี Sort", fmt.format(missingSort.length), `${fmt.format(sumBy(missingSort, "qtyEach"))} ชิ้นที่นับแล้ว`],
  ];

  const grid = $("#qualityGrid");
  if (grid) {
    grid.innerHTML = cards
      .map(
        ([tone, label, value, note]) => `
          <article class="insight-card ${tone}">
            <span>${html(label)}</span>
            <strong>${html(value)}</strong>
            <small>${html(note)}</small>
          </article>`
      )
      .join("");
  }

  const checks = [
    ["Column L = Not Picked", notCounted, "ตั้ง Qty ชิ้น/แพ็คเป็น 0 ก่อนสรุปทุกจุด", "raw"],
    ["ยังไม่มี Pick time", missingPick, "ไม่เข้า productivity ฝั่ง Pick", "raw"],
    ["ยังไม่มี Sort time", missingSort, "ยังไม่นับเป็น Sort สำเร็จ", "counted"],
    ["ไม่มีรหัส Picker", missingPicker, "ตรวจ Column E", "counted"],
    ["ไม่มีรหัส Sorter", missingSorter, "ตรวจ Column F", "counted"],
    ["ไม่พบกะ", noShift, "ตรวจเวลา Pick/Sort และ Column L/P", "counted"],
  ];

  const table = $("#qualityTable");
  if (!table) return;
  table.innerHTML = checks
    .map(([label, items, note, qtyMode]) => {
      const qtyEach = qtyMode === "raw" ? sumBy(items, "rawQtyEach") : sumBy(items, "qtyEach");
      const qtyPack = qtyMode === "raw" ? sumBy(items, "rawQtyPack") : sumBy(items, "qtyPack");
      return `
        <tr>
          <td>${html(label)}</td>
          <td class="num">${fmt.format(items.length)}</td>
          <td class="num">${fmt.format(qtyEach)}</td>
          <td class="num">${fmt.format(qtyPack)}</td>
          <td>${html(note)}</td>
        </tr>`;
    })
    .join("");
}

function syncMenu() {
  document.querySelectorAll("[data-menu-tab]").forEach((button) => {
    button.classList.toggle("active", button.dataset.menuTab === state.activeMenu);
  });
  document.querySelectorAll("[data-menu-section]").forEach((section) => {
    section.classList.toggle("menu-hidden", section.dataset.menuSection !== state.activeMenu);
  });
}

function syncRoleControls() {
  const mode = activeMode();
  $("#pickMode")?.classList.toggle("active", mode === "pick");
  $("#sortMode")?.classList.toggle("active", mode === "sort");
  document.body.dataset.roleMode = mode;
}

// ─── Previous period helpers ───────────────────────────────────────────────
function shiftDateStr(dateStr, days) {
  if (!dateStr) return "";
  const [y, m, d] = dateStr.split("-").map(Number);
  const dt = new Date(y, m - 1, d);
  dt.setDate(dt.getDate() + days);
  return `${dt.getFullYear()}-${pad2(dt.getMonth() + 1)}-${pad2(dt.getDate())}`;
}

function previousPeriodRecords() {
  const from = state.dateFrom;
  const to   = state.dateTo;
  if (!from || !to) return [];
  const fromMs = new Date(from).getTime();
  const toMs   = new Date(to).getTime();
  const spanDays = Math.round((toMs - fromMs) / 86400000) + 1;
  const prevFrom = shiftDateStr(from, -spanDays);
  const prevTo   = shiftDateStr(to,   -spanDays);
  const term = state.search.trim().toLowerCase();
  return records.filter((record) => {
    const date = filterDate(record);
    if (!date) return false;
    if (date < prevFrom || date > prevTo) return false;
    if (term && !searchText(record).includes(term)) return false;
    return true;
  });
}

function filteredDailyRecords() {
  const month = state.monthFilter; // e.g., "2026-06"
  if (!month) return filteredRecords(); // fallback
  const term = state.search.trim().toLowerCase();
  return records.filter((record) => {
    const date = filterDate(record);
    if (!date || !date.startsWith(month)) return false;
    if (term && !searchText(record).includes(term)) return false;
    if (!shiftMatches(record, state.shiftFilter)) return false;
    return true;
  });
}

function deltaHtml(current, prev, lowerIsBetter = false) {
  if (prev === null || prev === undefined || prev === 0 || current === null || current === undefined) {
    return `<span class="shift-stat-delta shift-stat-delta--neutral">— vs เมื่อวาน</span>`;
  }
  const diff = current - prev;
  const pct  = Math.abs(diff / prev) * 100;
  if (Math.abs(diff) < 0.001) {
    return `<span class="shift-stat-delta shift-stat-delta--neutral">= เท่าเดิม</span>`;
  }
  const isGood  = lowerIsBetter ? diff < 0 : diff > 0;
  const cls     = isGood ? "shift-stat-delta--up" : "shift-stat-delta--down";
  const arrow   = diff > 0 ? "▲" : "▼";
  const sign    = diff > 0 ? "+" : "";
  const pctStr  = pct >= 100 ? fmt.format(pct) : fmt1.format(pct);
  return `<span class="shift-stat-delta ${cls}">${arrow} ${sign}${pctStr}%</span>`;
}

// ───────────────────────────────────────────────────────────────────────────

function renderPendingSort(rows) {
  const panel = document.querySelector(".pending-sort-panel");
  if (panel) panel.style.display = activeMode() === "sort" ? "none" : "";
  if (activeMode() === "sort") return;

  const pendingRows = rows.filter((row) => row.pick.at && !row.sort.at);
  const totalRows = rows.filter((row) => row.pick.at);
  const sortedRows = totalRows.length - pendingRows.length;
  const sortPct = totalRows.length ? (sortedRows / totalRows.length) * 100 : 0;
  const pendingPct = totalRows.length ? (pendingRows.length / totalRows.length) * 100 : 0;

  const pendingQtyEach = sumBy(pendingRows, "qtyEach");
  const pendingQtyPack = sumBy(pendingRows, "qtyPack");

  const hint = $("#pendingSortHint");
  if (hint) hint.textContent = `${fmt.format(totalRows.length)} รายการที่ Pick แล้ว`;

  const container = $("#pendingSortContent");
  if (!container) return;

  if (!pendingRows.length) {
    container.innerHTML = `
      <div class="pending-sort-empty">
        <div class="pending-sort-done-icon">✅</div>
        <strong>Sort ครบแล้ว!</strong>
        <span>ทุกรายการที่ Pick แล้วถูก Sort หมดแล้ว</span>
      </div>`;
    return;
  }

  // Group pending by shift
  const pendingDay = pendingRows.filter((r) => r.shift?.group === "day");
  const pendingNight = pendingRows.filter((r) => r.shift?.group === "night");
  const pendingOther = pendingRows.filter((r) => !r.shift || !["day", "night"].includes(r.shift?.group));

  // Top 5 pending waves
  const waveMap = new Map();
  pendingRows.forEach((row) => {
    const w = row.wave || "ไม่ทราบ";
    if (!waveMap.has(w)) waveMap.set(w, { wave: w, count: 0, qtyEach: 0 });
    const entry = waveMap.get(w);
    entry.count += 1;
    entry.qtyEach += row.qtyEach || 0;
  });
  const topWaves = [...waveMap.values()].sort((a, b) => b.qtyEach - a.qtyEach).slice(0, 5);
  const maxWaveQty = Math.max(...topWaves.map((w) => w.qtyEach), 1);

  container.innerHTML = `
    <div class="pending-sort-grid">
      <div class="pending-main-card">
        <div class="pending-big-number">${fmt.format(pendingRows.length)}</div>
        <div class="pending-big-label">รายการ ยังไม่ได้ Sort</div>
        <div class="pending-progress-wrap">
          <div class="pending-progress-bar">
            <div class="pending-progress-fill pending-fill-sorted" style="width:${sortPct}%"></div>
            <div class="pending-progress-fill pending-fill-pending" style="width:${pendingPct}%"></div>
          </div>
          <div class="pending-progress-labels">
            <span class="pending-sorted-label">✅ Sort แล้ว ${fmt.format(sortedRows)} (${fmt1.format(sortPct)}%)</span>
            <span class="pending-pending-label">⏳ คงเหลือ ${fmt.format(pendingRows.length)} (${fmt1.format(pendingPct)}%)</span>
          </div>
        </div>
      </div>

      <div class="pending-stats-row">
        <div class="pending-stat-card pending-stat-qty">
          <div class="pending-stat-icon">📦</div>
          <div class="pending-stat-value">${fmt.format(pendingQtyEach)}</div>
          <div class="pending-stat-label">ชิ้นคงเหลือ</div>
        </div>
        <div class="pending-stat-card pending-stat-pack">
          <div class="pending-stat-icon">📋</div>
          <div class="pending-stat-value">${fmt.format(pendingQtyPack)}</div>
          <div class="pending-stat-label">แพ็คคงเหลือ</div>
        </div>
        <div class="pending-stat-card pending-stat-day">
          <div class="pending-stat-icon">☀️</div>
          <div class="pending-stat-value">${fmt.format(pendingDay.length)}</div>
          <div class="pending-stat-label">DAY คงเหลือ</div>
          <div class="pending-stat-sub">${fmt.format(sumBy(pendingDay, "qtyEach"))} ชิ้น</div>
        </div>
        <div class="pending-stat-card pending-stat-night">
          <div class="pending-stat-icon">🌙</div>
          <div class="pending-stat-value">${fmt.format(pendingNight.length)}</div>
          <div class="pending-stat-label">NIGHT คงเหลือ</div>
          <div class="pending-stat-sub">${fmt.format(sumBy(pendingNight, "qtyEach"))} ชิ้น</div>
        </div>
      </div>

      ${topWaves.length ? `
      <div class="pending-waves-section">
        <div class="pending-waves-title">📌 Wave ที่ค้างมากสุด</div>
        <div class="pending-waves-list">
          ${topWaves.map((w, i) => {
            const pct = (w.qtyEach / maxWaveQty) * 100;
            return `
            <div class="pending-wave-item">
              <span class="pending-wave-rank">${i + 1}</span>
              <span class="pending-wave-name">${html(w.wave)}</span>
              <div class="pending-wave-bar-wrap">
                <div class="pending-wave-bar" style="width:${pct}%"></div>
              </div>
              <span class="pending-wave-qty">${fmt.format(w.qtyEach)} ชิ้น</span>
              <span class="pending-wave-count">${fmt.format(w.count)} รายการ</span>
            </div>`;
          }).join("")}
        </div>
      </div>` : ""}
    </div>`;
}

// ───────────────────────────────────────────────────────────────────────────

function render() {
  syncRoleControls();
  const rows = filteredRecords();
  const shiftRows = filteredRecords({ ignoreShift: true });
  const prevRows = previousPeriodRecords();
  const prevShiftRows = prevRows; // same set, ignoring shift filter
  
  const dailyRows = filteredDailyRecords();

  renderKpis(rows, prevRows);
  renderDayNightSummary(shiftRows, prevShiftRows);
  renderPendingSort(rows);
  renderPickSortView(rows);
  renderDailyShiftOverview(dailyRows);
  renderDailyChart(dailyRows);

  function renderDayNightSummary(rows, prevRows) {
    const mode = activeMode();
    const hint = $("#dayNightHint");
    const spanDays = (state.dateFrom && state.dateTo)
      ? Math.round((new Date(state.dateTo) - new Date(state.dateFrom)) / 86400000) + 1
      : 1;
    const prevLabel = spanDays === 1 ? "vs เมื่อวาน" : `vs ${spanDays} วันก่อน`;
    if (hint) hint.textContent = `${roleLabel(mode)} · สรุปยอดแยกตาม DAY และ NIGHT  ·  ${prevLabel}`;

    const container = $("#dayNightCards");
    if (!container) return;

    const groups = [
      { key: "day",   label: "DAY",   emoji: "☀️",  colorClass: "shift-day" },
      { key: "night", label: "NIGHT", emoji: "🌙",  colorClass: "shift-night" },
    ];

    const roleRows = rowsForRole(rows, mode);
    const prevRoleRows = rowsForRole(prevRows, mode);
    const total = { qtyEach: sumBy(roleRows, "qtyEach"), qtyPack: sumBy(roleRows, "qtyPack") };

    container.innerHTML = groups.map((g) => {
      // current
      const items        = roleRows.filter((r) => roleShift(r, mode)?.group === g.key);
      const totalQtyEach = sumBy(items, "qtyEach");
      const totalQtyPack = sumBy(items, "qtyPack");
      const sorted       = items.filter((r) => r.sort?.at).length;
      const sortedRate   = items.length ? (sorted / items.length) * 100 : 0;
      const productivity = calculateRoleProductivity(items, mode);
      const workers      = uniqueCount(items, (r) => roleWorker(r).code);
      const waves        = uniqueCount(items, (r) => r.wave);
      const branches     = new Set(items.map((r) => r.branch).filter(Boolean)).size;
      const pct          = total.qtyEach ? (totalQtyEach / total.qtyEach) * 100 : 0;

      // previous
      const pItems        = prevRoleRows.filter((r) => roleShift(r, mode)?.group === g.key);
      const pQtyEach      = pItems.length ? sumBy(pItems, "qtyEach")  : null;
      const pQtyPack      = pItems.length ? sumBy(pItems, "qtyPack")  : null;
      const pSorted       = pItems.filter((r) => r.sort?.at).length;
      const pSortedRate   = pItems.length ? (pSorted / pItems.length) * 100 : null;
      const pProductivity = calculateRoleProductivity(pItems, mode);
      const pWorkers      = pItems.length
        ? uniqueCount(pItems, (r) => roleWorker(r).code)
        : null;
      const pWaves        = pItems.length ? uniqueCount(pItems, (r) => r.wave) : null;
      const pBranches     = pItems.length
        ? new Set(pItems.map((r) => r.branch).filter(Boolean)).size
        : null;

      const hasPrev = pItems.length > 0;

      return `
        <div class="shift-card ${g.colorClass}">
          <div class="shift-card-header">
            <span class="shift-card-emoji">${g.emoji}</span>
            <span class="shift-card-label">${html(g.label)}</span>
            <span class="shift-card-pct">${fmt1.format(pct)}% ของรวม</span>
          </div>
          ${hasPrev ? `<div class="shift-prev-label">${prevLabel}</div>` : ""}
          <div class="shift-card-stats">
            <div class="shift-stat">
              <div class="shift-stat-value">${fmt.format(totalQtyEach)}</div>
              <div class="shift-stat-label">ชิ้น</div>
              ${hasPrev ? deltaHtml(totalQtyEach, pQtyEach) : ""}
              ${hasPrev ? `<div class="shift-stat-prev">${fmt.format(pQtyEach)}</div>` : ""}
            </div>
            <div class="shift-stat">
              <div class="shift-stat-value">${fmt.format(totalQtyPack)}</div>
              <div class="shift-stat-label">แพ็ค</div>
              ${hasPrev ? deltaHtml(totalQtyPack, pQtyPack) : ""}
              ${hasPrev ? `<div class="shift-stat-prev">${fmt.format(pQtyPack)}</div>` : ""}
            </div>
            <div class="shift-stat">
              <div class="shift-stat-value">${mode === "sort" ? fmt.format(items.length) : (items.length ? fmt1.format(sortedRate) + "<span class='shift-stat-unit'>%</span>" : "–")}</div>
              <div class="shift-stat-label">${mode === "sort" ? "รายการ Sort" : "Sort สำเร็จ"}</div>
              ${mode !== "sort" && hasPrev && pSortedRate !== null ? deltaHtml(sortedRate, pSortedRate) : ""}
              ${mode !== "sort" && hasPrev && pSortedRate !== null ? `<div class="shift-stat-prev">${fmt1.format(pSortedRate)}%</div>` : ""}
            </div>
            <div class="shift-stat">
              <div class="shift-stat-value">${fmt.format(waves)}</div>
              <div class="shift-stat-label">Wave</div>
              ${hasPrev ? deltaHtml(waves, pWaves) : ""}
              ${hasPrev ? `<div class="shift-stat-prev">${fmt.format(pWaves)} Wave</div>` : ""}
            </div>
            <div class="shift-stat">
              <div class="shift-stat-value">${productivity.totalQtyPack ? `${fmt1.format(productivity.productivity)}<span class='shift-stat-unit'>แพ็ค/hr</span>` : "–"}</div>
              <div class="shift-stat-label">Productivity</div>
              ${hasPrev && pProductivity.totalQtyPack ? deltaHtml(productivity.productivity, pProductivity.productivity) : ""}
              ${hasPrev && pProductivity.totalQtyPack ? `<div class="shift-stat-prev">${fmt1.format(pProductivity.productivity)} แพ็ค/hr</div>` : ""}
            </div>
            <div class="shift-stat">
              <div class="shift-stat-value">${fmt.format(branches)}</div>
              <div class="shift-stat-label">สาขา</div>
              ${hasPrev ? deltaHtml(branches, pBranches) : ""}
              ${hasPrev ? `<div class="shift-stat-prev">${fmt.format(pBranches)} สาขา</div>` : ""}
            </div>
            <div class="shift-stat">
              <div class="shift-stat-value">${fmt.format(workers)}</div>
              <div class="shift-stat-label">คน</div>
              ${hasPrev ? deltaHtml(workers, pWorkers) : ""}
              ${hasPrev ? `<div class="shift-stat-prev">${fmt.format(pWorkers)} คน</div>` : ""}
            </div>
          </div>
        </div>`;
    }).join("");
  }
  renderDailyDayNight(dailyRows);
  renderPeople(rows);
  renderEmployeeSlotDashboard(rows);
  renderProductItems(rows);
  renderSlots(rows);
  renderWaves(rows);
  renderSlowRows(rows);
  renderBranchesView(rows);
  renderQuality(rows);
  syncMenu();
  
  $("#metaRows").textContent = `${fmt.format(records.length)} รายการ`;
  
  $("#metaLatestJob").textContent = `ข้อมูลล่าสุด: ${sourceMeta.generatedAt || "-"}`;

  $("#exportBtn").disabled = isLoading || !(state.activeMenu === "daily" ? dailyRows.length : rows.length);
}

function renderDailyShiftOverview(rows) {
  const mode = activeMode();
  const summaries = dailyShiftSummary(rows, mode);
  const roleRows = rowsForRole(rows, mode);
  const hint = $("#dailyShiftHint");
  if (hint) {
    const basis = mode === "sort" ? "เวลา Sort / Slot Sort" : "เวลา Pick";
    hint.textContent = `${roleLabel(mode)} · ${fmt.format(roleRows.length)} รายการ · ${basis}`;
  }

  const container = $("#dailyShiftCards");
  if (!container) return;
  if (!roleRows.length) {
    container.innerHTML = `<div class="daily-shift-empty">ไม่มีข้อมูล</div>`;
    return;
  }

  const totalQty = sumBy(roleRows, "qtyEach");
  container.innerHTML = summaries
    .map((summary) => {
      const pct = totalQty ? (summary.qtyEach / totalQty) * 100 : 0;
      return `
        <div class="shift-card ${summary.colorClass}">
          <div class="shift-card-header">
            <span class="shift-card-emoji">${summary.emoji}</span>
            <span class="shift-card-label">${html(summary.label)} <small>${html(summary.shortLabel)}</small></span>
            <span class="shift-card-pct">${fmt1.format(pct)}% ของรวม</span>
          </div>
          <div class="daily-shift-window">
            <span>เวลาปกติ ${html(summary.window)}</span>
            <span>OT ${html(summary.otWindow)}</span>
          </div>
          <div class="shift-card-stats">
            <div class="shift-stat">
              <div class="shift-stat-value">${summary.branches ? fmt.format(summary.branches) : "–"}</div>
              <div class="shift-stat-label">สาขา</div>
            </div>
            <div class="shift-stat">
              <div class="shift-stat-value">${hourStat(summary.totalHours)}</div>
              <div class="shift-stat-label">เวลารวม</div>
            </div>
            <div class="shift-stat">
              <div class="shift-stat-value">${hourStat(summary.otHours)}</div>
              <div class="shift-stat-label">OT ชั่วโมง</div>
            </div>
            <div class="shift-stat">
              <div class="shift-stat-value">${summary.workers ? fmt.format(summary.workers) : "–"}</div>
              <div class="shift-stat-label">คน</div>
            </div>
            <div class="shift-stat">
              <div class="shift-stat-value">${summary.qtyEach ? fmt.format(summary.qtyEach) : "–"}</div>
              <div class="shift-stat-label">ชิ้น</div>
            </div>
            <div class="shift-stat">
              <div class="shift-stat-value">${summary.qtyPack ? fmt.format(summary.qtyPack) : "–"}</div>
              <div class="shift-stat-label">แพ็ค</div>
            </div>
          </div>
        </div>`;
    })
    .join("");
}

function renderDailyDayNight(rows) {
  const mode = activeMode();
  const roleRows = rowsForRole(rows, mode);
  const hint = $("#dayNightByDateHint");
  if (hint) hint.textContent = `${roleLabel(mode)} · ยอดรวมต่อวัน แยก DAY / NIGHT`;

  const groupsByDate = new Map();
  roleRows.forEach((r) => {
    const date = rowDate(r, mode) || "(ไม่มีวันที่)";
    if (!groupsByDate.has(date)) groupsByDate.set(date, []);
    groupsByDate.get(date).push(r);
  });

  const dates = [...groupsByDate.keys()].sort((a, b) => a.localeCompare(b));
  let totalDayEach = 0;
  let totalNightEach = 0;
  let totalDayPack = 0;
  let totalNightPack = 0;

  const lines = dates
    .map((date) => {
      const items = groupsByDate.get(date) || [];
      const dayItems = items.filter((x) => roleShift(x, mode)?.group === "day");
      const nightItems = items.filter((x) => roleShift(x, mode)?.group === "night");
      const unassignedItems = items.filter((x) => !roleShift(x, mode) || (roleShift(x, mode)?.group !== "day" && roleShift(x, mode)?.group !== "night"));
      const dayQty = sumBy(dayItems, "qtyEach");
      const nightQty = sumBy(nightItems, "qtyEach");
      const unassignedQty = sumBy(unassignedItems, "qtyEach");
      const dayPack = sumBy(dayItems, "qtyPack");
      const nightPack = sumBy(nightItems, "qtyPack");
      const unassignedPack = sumBy(unassignedItems, "qtyPack");
      const total = dayQty + nightQty + unassignedQty;
      const totalPack = dayPack + nightPack + unassignedPack;
      const totalBranches = new Set(items.map((x) => x.branch).filter(Boolean)).size;

      totalDayEach += dayQty;
      totalNightEach += nightQty;
      totalDayPack += dayPack;
      totalNightPack += nightPack;

      const note = total === 0 ? "-" : `${fmt1.format((dayQty / total) * 100 || 0)}% / ${fmt1.format((nightQty / total) * 100 || 0)}%`;
      return `
        <tr>
          <td>${html(date)}</td>
          <td class="num col-day">${qtyStack(dayQty, dayPack)}</td>
          <td class="num col-night">${qtyStack(nightQty, nightPack)}</td>
          <td class="num col-total">${qtyStack(total, totalPack)}</td>
          <td class="num">${html(note)}</td>
          <td class="num">${totalBranches ? fmt.format(totalBranches) : "-"}</td>
        </tr>`;
    })
    .join("");

  const table = $("#dayNightByDateTable");
  if (!table) return;
  if (!lines) {
    table.innerHTML = `<tr><td colspan="6" class="empty">ไม่มีข้อมูล</td></tr>`;
    return;
  }

  // Need to calculate grand total across all rows for the overall total column, to ensure it doesn't just sum day+night if there are hidden unassigned items
  const overallTotalEach = sumBy(roleRows, "qtyEach");
  const overallTotalPack = sumBy(roleRows, "qtyPack");
  const overallTotalBranches = new Set(roleRows.map((x) => x.branch).filter(Boolean)).size;
  
  const footer = `
    <tr class="group-header">
      <td><strong>รวม</strong></td>
      <td class="num col-day">${qtyStack(totalDayEach, totalDayPack)}</td>
      <td class="num col-night">${qtyStack(totalNightEach, totalNightPack)}</td>
      <td class="num col-total">${qtyStack(overallTotalEach, overallTotalPack)}</td>
      <td class="num"><strong>${fmt1.format((totalDayEach / (overallTotalEach || 1)) * 100)}% / ${fmt1.format((totalNightEach / (overallTotalEach || 1)) * 100)}%</strong></td>
      <td class="num"><strong>${overallTotalBranches ? fmt.format(overallTotalBranches) : "-"}</strong></td>
    </tr>`;

  table.innerHTML = lines + footer;
}

function syncDateControls(resetToBounds = false) {
  const todayStr = getLocalDateString();
  $("#dateFrom").min = sourceMeta.dateMin || "";
  $("#dateFrom").max = todayStr;
  $("#dateTo").min = sourceMeta.dateMin || "";
  $("#dateTo").max = todayStr;
  if (resetToBounds || !state.dateFrom) state.dateFrom = todayStr;
  if (resetToBounds || !state.dateTo) state.dateTo = todayStr;
  if (resetToBounds || !state.monthFilter) state.monthFilter = todayStr.substring(0, 7);
  $("#dateFrom").value = state.dateFrom;
  $("#dateTo").value = state.dateTo;
  if ($("#monthFilter")) $("#monthFilter").value = state.monthFilter;
}

async function loadData({ keepFilters = false } = {}) {
  if (isLoading) return;
  setLoading(true);
  setStatus("กำลังโหลด", "loading");
  try {
    // 1. Fetch the main data sheet first (public and fast)
    const payload = await loadSheetViaJsonp();
    
    // 2. Parse main data immediately
    msCache.clear();
    const rawRows = rowsFromGviz(payload);
    const result = normalizeRecords(rawRows);
    records = result.records;
    sourceMeta = deriveMeta(records, result.skippedRows);
    syncDateControls(!keepFilters);
    
    // 3. Render the dashboard immediately using the static fallback staff list
    render();
    setStatus("", "");
    setLoading(false); // Done loading main data!

    // 4. Fetch the staff list asynchronously in the background
    loadStaffLookup()
      .then((loadedStaff) => {
        staffLookup = loadedStaff.lookup || {};
        staffMeta = {
          loaded: !loadedStaff.error,
          count: loadedStaff.count || Object.keys(staffLookup).length,
          error: loadedStaff.error || "",
          fallback: Boolean(loadedStaff.fallback),
        };
        // Re-render to show online staff names if successfully fetched
        if (!loadedStaff.error) {
          console.info(`โหลดรายชื่อพนักงานสำเร็จจากชีตสด: ${loadedStaff.count} คน`);
          render();
        }
      })
      .catch((error) => {
        console.warn("ไม่สามารถโหลดรายชื่อพนักงานจาก Google Sheet ได้, ใช้รายชื่อสำรองแทน:", error);
      });

  } catch (error) {
    console.error(error);
    setStatus(error.message || "โหลดข้อมูลไม่สำเร็จ", "error");
    render();
    setLoading(false);
  }
}

function initEvents() {
  document.querySelectorAll("[data-menu-tab]").forEach((button) => {
    button.addEventListener("click", () => {
      state.activeMenu = button.dataset.menuTab || "overview";
      render();
    });
  });
  $("#dateFrom").addEventListener("change", (event) => {
    state.dateFrom = event.target.value;
    render();
  });
  $("#dateTo").addEventListener("change", (event) => {
    state.dateTo = event.target.value;
    render();
  });
  if ($("#monthFilter")) {
    $("#monthFilter").addEventListener("change", (event) => {
      state.monthFilter = event.target.value;
      render();
    });
  }
  let searchTimeout;
  $("#searchInput").addEventListener("input", (event) => {
    state.search = event.target.value;
    clearTimeout(searchTimeout);
    searchTimeout = setTimeout(render, 250);
  });
  $("#shiftFilter").addEventListener("change", (event) => {
    state.shiftFilter = event.target.value;
    render();
  });
  $("#pickMode").addEventListener("click", () => {
    state.peopleMode = "pick";
    $("#pickMode").classList.add("active");
    $("#sortMode").classList.remove("active");
    render();
  });
  $("#sortMode").addEventListener("click", () => {
    state.peopleMode = "sort";
    $("#sortMode").classList.add("active");
    $("#pickMode").classList.remove("active");
    render();
  });
  $("#refreshBtn").addEventListener("click", () => loadData({ keepFilters: true }));
  $("#resetBtn").addEventListener("click", () => {
    state.search = "";
    state.shiftFilter = "all";
    $("#searchInput").value = "";
    $("#shiftFilter").value = state.shiftFilter;
    syncDateControls(true);
    render();
  });
  $("#exportBtn").addEventListener("click", () => exportCurrentMenuExcel());
}

function init() {
  initEvents();
  render();
  loadData();
  if (config.autoRefreshMs > 0) {
    window.setInterval(() => {
      loadData({ keepFilters: true });
    }, config.autoRefreshMs);
  }
}

init();
