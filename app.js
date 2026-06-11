const DEFAULT_CONFIG = {
  sheetId: "1Rd1KWLNZPIgSFfOnM1sCLjMmGhtRFuIXfHFPYjfg74o",
  gid: "377885389",
  sheetName: "Data",
  range: "A:P",
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
  day_normal: "DAY 08:00-17:00",
  day_ot: "OT DAY 17:30-20:00",
  night: "NIGHT รวม OT",
  night_normal: "NIGHT 20:00-05:00",
  night_ot: "OT NIGHT 05:30-08:00",
  transition: "พัก/เปลี่ยนกะ",
};

const SHIFT_SUMMARY_ROWS = [
  { key: "day_normal", label: "DAY", window: "08:00-17:00", group: "day" },
  { key: "day_ot", label: "OT DAY", window: "17:30-20:00", group: "day" },
  { key: "night_normal", label: "NIGHT", window: "20:00-05:00", group: "night" },
  { key: "night_ot", label: "OT NIGHT", window: "05:30-08:00", group: "night" },
  { key: "transition", label: "พัก/เปลี่ยนกะ", window: "17:00-17:30 / 05:00-05:30", group: "transition" },
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
  if (source.range) params.set("range", source.range);
  return `https://docs.google.com/spreadsheets/d/${source.sheetId}/gviz/tq?${params.toString()}`;
}

function loadSheetViaJsonp(source = config) {
  return new Promise((resolve, reject) => {
    const callbackName = `__pickToSort_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    const script = document.createElement("script");
    let done = false;
    const timeoutId = window.setTimeout(() => {
      cleanup();
      reject(new Error("โหลดข้อมูลจาก Google Sheet ไม่สำเร็จในเวลาที่กำหนด"));
    }, 45000);

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

  if (total >= 480 && total <= 1020) {
    return { key: "day_normal", group: "day", label: "DAY", shortLabel: "DAY", window: "08:00-17:00", date, isOt: false };
  }
  if (total >= 1050 && total < 1200) {
    return { key: "day_ot", group: "day", label: "OT DAY", shortLabel: "OT DAY", window: "17:30-20:00", date, isOt: true };
  }
  if (total >= 1200 || total <= 300) {
    return {
      key: "night_normal",
      group: "night",
      label: "NIGHT",
      shortLabel: "NIGHT",
      window: "20:00-05:00",
      date: total <= 300 ? previousDate(date) : date,
      isOt: false,
    };
  }
  if (total >= 330 && total < 480) {
    return { key: "night_ot", group: "night", label: "OT NIGHT", shortLabel: "OT NIGHT", window: "05:30-08:00", date: previousDate(date), isOt: true };
  }

  const isMorningTransition = total > 300 && total < 330;
  return {
    key: "transition",
    group: "transition",
    label: "พัก/เปลี่ยนกะ",
    shortLabel: "พัก",
    window: isMorningTransition ? "05:00-05:30" : "17:00-17:30",
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
  const payload = await loadSheetViaJsonp(source);
  const lookup = buildStaffLookup(rowsFromGviz(payload));
  return { lookup, count: Object.keys(lookup).length };
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
    };
    const pick = resolveWorkTime(source, "pick");
    const sort = resolveWorkTime(source, "sort");
    // ใช้ Pick time เป็นหลัก ถ้าไม่มี Pick time จึงใช้ Sort time
    const workTimeForShift = pick.at ? pick : sort;
    const shiftSource = pick.at ? source.pickShift : source.sortShift;
    const shift = shiftInfo(workTimeForShift, shiftSource);
    const rawQtyEach = number(row[indexes.qtyEach]);
    const rawQtyPack = number(row[indexes.qtyPack]);
    const shouldCountQty = !isNotPickedStatus(rawCell("pickShift"));
    const wave = source.wave;
    const item = source.item;
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
      shift,
      source,
      cycleMinutes,
    });
  });

  return { records: normalized, skippedRows };
}

function deriveMeta(rows, skippedRows) {
  const dates = [...new Set(rows.map(rowDate).filter(Boolean))].sort();
  
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

function rowDate(record) {
  // Prefer explicit shift date when available
  if (record.shift?.date) return record.shift.date;

  // Fallback to pick/sort date but adjust for night windows that belong to previous day
  const date = record.pick?.date || record.sort?.date || "";
  const time = record.pick?.time || record.sort?.time || "";
  if (!date) return "";

  if (time) {
    const parts = time.split(":").map((p) => Number(p));
    const hh = parts[0] ?? 0;
    const mm = parts[1] ?? 0;
    if (!Number.isNaN(hh)) {
      const total = hh * 60 + mm;
      // 00:00-05:00 (0-300) should be counted to previous day
      // 05:30-08:00 (330-480) also considered Night OT -> count to previous day
      if (total <= 300 || (total >= 330 && total < 480)) return previousDate(date);
    }
  }
  return date;
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
  const label = worker.nick || worker.name || worker.code;
  return `${html(label)} (${html(worker.code)})`;
}

function searchText(record) {
  return [
    record.wave,
    record.item,
    record.picker.code,
    record.picker.nick,
    record.picker.name,
    record.sorter.code,
    record.sorter.nick,
    record.sorter.name,
    record.shift?.label,
    record.shift?.window,
    record.shift?.date,
  ]
    .join(" ")
    .toLowerCase();
}

function shiftMatches(record, filterValue) {
  if (!filterValue || filterValue === "all") return true;
  if (filterValue === "day" || filterValue === "night") return record.shift?.group === filterValue;
  if (filterValue === "transition") return record.shift?.group === "transition";
  return record.shift?.key === filterValue;
}

function filteredRecords({ ignoreShift = false } = {}) {
  const term = state.search.trim().toLowerCase();
  return records.filter((record) => {
    const date = rowDate(record);
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
  let sumRatesEach = 0;
  
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
      const qtyEach = sumBy(pickerRows, "qtyEach") + sumBy(sorterRows, "qtyEach");
      sumRatesEach += qtyEach / activeHours;
      totalWorkers += 1;
    }
  });
  
  return {
    avgEach: totalWorkers > 0 ? sumRatesEach / totalWorkers : 0,
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
  const totalQtyEach = sumBy(rows, "qtyEach");
  const productivity = totalActiveHours > 0 ? totalQtyEach / totalActiveHours : 0;
  
  return {
    productivity,
    totalActiveHours,
    totalQtyEach,
  };
}

function calculateProductivityByShift(rows, shiftGroup) {
  const filteredRows = rows.filter(row => row.shift?.group === shiftGroup);
  if (!filteredRows.length) return { productivity: 0, totalActiveHours: 0, totalQtyEach: 0 };
  
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
  const totalQtyEach = sumBy(filteredRows, "qtyEach");
  const productivity = totalActiveHours > 0 ? totalQtyEach / totalActiveHours : 0;
  
  return {
    productivity,
    totalActiveHours,
    totalQtyEach,
  };
}

function renderKpis(rows, prevRows = []) {
  const cycles = rows.map((row) => row.cycleMinutes).filter((value) => value !== null);
  const sorted = rows.filter((row) => row.sort.at).length;
  const avgCycle = mean(cycles);
  const waves = uniqueCount(rows, (row) => row.wave);
  const items = uniqueCount(rows, (row) => row.item);
  const sortedRate = rows.length ? (sorted / rows.length) * 100 : 0;

  const totalQtyEach = sumBy(rows, "qtyEach");
  const totalQtyPack = sumBy(rows, "qtyPack");
  const notCountedRows = rows.filter((row) => row.countedQty === false);
  const notCountedQtyEach = sumBy(notCountedRows, "rawQtyEach");
  const notCountedQtyPack = sumBy(notCountedRows, "rawQtyPack");
  const avgStaffProd = calculateAvgStaffProductivity(rows);
  const totalProd = calculateTotalProductivity(rows);
  const dayProd = calculateProductivityByShift(rows, "day");
  const nightProd = calculateProductivityByShift(rows, "night");

  // previous period metrics
  const hasPrev = prevRows.length > 0;
  const pCycles = prevRows.map((r) => r.cycleMinutes).filter((v) => v !== null);
  const pSorted = prevRows.filter((r) => r.sort.at).length;
  const pTotalQtyEach  = hasPrev ? sumBy(prevRows, "qtyEach") : null;
  const pTotalQtyPack  = hasPrev ? sumBy(prevRows, "qtyPack") : null;
  const pSortedRate    = hasPrev && prevRows.length ? (pSorted / prevRows.length) * 100 : null;
  const pAvgCycle      = hasPrev ? mean(pCycles) : null;
  const pWorkers       = hasPrev ? uniqueCount(prevRows, (r) => r.picker.code) + uniqueCount(prevRows, (r) => r.sorter.code) : null;
  const pTotalProd     = hasPrev ? calculateTotalProductivity(prevRows) : null;
  const pDayProd       = hasPrev ? calculateProductivityByShift(prevRows, "day") : null;
  const pNightProd     = hasPrev ? calculateProductivityByShift(prevRows, "night") : null;

  function kpiDelta(cur, prev, lowerIsBetter = false) {
    if (!hasPrev || prev === null || prev === undefined) return "";
    return `<div class="kpi-delta-row">${deltaHtml(cur, prev, lowerIsBetter)}<span class="kpi-prev-val">${typeof prev === "number" && prev % 1 !== 0 ? fmt1.format(prev) : fmt.format(prev)}</span></div>`;
  }

  const kpis = [
    {
      color: "indigo",
      label: "Qty ชิ้น",
      value: fmt.format(totalQtyEach),
      note: `${fmt.format(items)} items`,
      delta: kpiDelta(totalQtyEach, pTotalQtyEach),
    },
    {
      color: "amber",
      label: "Qty แพ็ค",
      value: fmt.format(totalQtyPack),
      note: "AO / UOM Qty",
      delta: kpiDelta(totalQtyPack, pTotalQtyPack),
    },
    {
      color: "cyan",
      label: "Sort สำเร็จ",
      value: `${fmt1.format(sortedRate)}%`,
      note: `${fmt.format(sorted)} รายการ`,
      delta: kpiDelta(sortedRate, pSortedRate),
    },
    {
      color: "teal",
      label: "จำนวนคน",
      value: fmt.format(uniqueCount(rows, (r) => r.picker.code) + uniqueCount(rows, (r) => r.sorter.code)),
      note: "Pick + Sort",
      delta: kpiDelta(uniqueCount(rows, (r) => r.picker.code) + uniqueCount(rows, (r) => r.sorter.code), pWorkers),
    },
    {
      color: "cyan",
      label: "Productivity รวม",
      value: `${fmt1.format(totalProd.productivity)} ชิ้น/hr`,
      note: `${fmt.format(totalProd.totalQtyEach)} ชิ้น / ${fmt1.format(totalProd.totalActiveHours)} ชม.`,
      delta: hasPrev && pTotalProd ? kpiDelta(totalProd.productivity, pTotalProd.productivity) : "",
    },
    ...(dayProd.totalQtyEach > 0 ? [{
      color: "amber",
      label: "Productivity DAY",
      value: `${fmt1.format(dayProd.productivity)} ชิ้น/hr`,
      note: `${fmt.format(dayProd.totalQtyEach)} ชิ้น / ${fmt1.format(dayProd.totalActiveHours)} ชม.`,
      delta: hasPrev && pDayProd ? kpiDelta(dayProd.productivity, pDayProd.productivity) : "",
    }] : []),
    ...(nightProd.totalQtyEach > 0 ? [{
      color: "indigo",
      label: "Productivity NIGHT",
      value: `${fmt1.format(nightProd.productivity)} ชิ้น/hr`,
      note: `${fmt.format(nightProd.totalQtyEach)} ชิ้น / ${fmt1.format(nightProd.totalActiveHours)} ชม.`,
      delta: hasPrev && pNightProd ? kpiDelta(nightProd.productivity, pNightProd.productivity) : "",
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

function dailySummary(rows) {
  return [...groupBy(rows, rowDate).entries()]
    .map(([date, items]) => ({
      date,
      qtyPack: sumBy(items, "qtyPack"),
      qtyEach: sumBy(items, "qtyEach"),
      avgCycle: mean(items.map((row) => row.cycleMinutes)),
    }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

function renderDailyChart(rows) {
  const daily = dailySummary(rows);
  $("#dailyHint").textContent = `${fmt.format(daily.length)} วัน`;
  if (!daily.length) {
    $("#dailyChart").innerHTML = `<div class="empty">ไม่มีข้อมูล</div>`;
    return;
  }

  const width = 1200;
  const height = 360;
  const pad = { top: 40, right: 60, bottom: 50, left: 64 };
  const innerW = width - pad.left - pad.right;
  const innerH = height - pad.top - pad.bottom;
  const maxQty = Math.max(...daily.map((day) => day.qtyPack), 1);
  const maxCycle = Math.max(...daily.map((day) => day.avgCycle || 0), 1);
  const barW = Math.max(12, innerW / daily.length - 8);
  const xFor = (index) => pad.left + (index * innerW) / Math.max(1, daily.length - 1);
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
      const x = xFor(index) - barW / 2;
      const y = yQty(day.qtyPack);
      const h = pad.top + innerH - y;
      // Ensure minimum height for visibility
      const finalH = Math.max(h, 4);
      const finalY = pad.top + innerH - finalH;
      return `
        <g class="chart-group">
          <rect class="chart-bar" x="${x}" y="${finalY}" width="${barW}" height="${finalH}" rx="4" fill="url(#barGrad)" opacity="0.85">
            <title>${html(day.date)}: ${fmt.format(day.qtyPack)} แพ็ค</title>
          </rect>
          <text class="chart-val-hover" x="${xFor(index)}" y="${finalY - 8}" text-anchor="middle">${fmt.format(day.qtyPack)}</text>
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
        <linearGradient id="barGrad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="#38bdf8"/>
          <stop offset="100%" stop-color="#0284c7" stop-opacity="0.1"/>
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
      <text class="axis-label axis-title" x="${pad.left}" y="14">Qty (แพ็ค)</text>
      <text class="axis-label axis-title" x="${width - pad.right}" y="14" text-anchor="end">เฉลี่ย (นาที)</text>
    </svg>
    <div class="legend" style="margin-top: 10px;">
      <span><i style="background: linear-gradient(135deg, #38bdf8, #0284c7)"></i>Qty แพ็ค</span>
      <span><i style="background: linear-gradient(135deg, #818cf8, #c084fc)"></i>Pick to Sort เฉลี่ย</span>
    </div>`;
}

function renderSlots(rows) {
  const slots = Array.from({ length: 24 }, (_, hour) => ({
    key: `${hour}`.padStart(2, "0"),
    label: `${hour}`.padStart(2, "0") + ":00",
    pickCount: 0,
    sortCount: 0,
    pickQtyEach: 0,
    pickQtyPack: 0,
    sortQtyEach: 0,
    sortQtyPack: 0,
  }));
  const bySlot = new Map(slots.map((slot) => [slot.key, slot]));
  rows.forEach((row) => {
    if (row.pick.slotKey && bySlot.has(row.pick.slotKey)) {
      const slot = bySlot.get(row.pick.slotKey);
      slot.pickCount += 1;
      slot.pickQtyEach += row.qtyEach || 0;
      slot.pickQtyPack += row.qtyPack || 0;
    }
    if (row.sort.slotKey && bySlot.has(row.sort.slotKey)) {
      const slot = bySlot.get(row.sort.slotKey);
      slot.sortCount += 1;
      slot.sortQtyEach += row.qtyEach || 0;
      slot.sortQtyPack += row.qtyPack || 0;
    }
  });
  const visible = slots.filter((slot) => slot.pickCount || slot.sortCount);
  const max = Math.max(...visible.map((slot) => slot.pickCount + slot.sortCount), 1);
  $("#slotHint").textContent = `${fmt.format(visible.length)} slots`;
  
  if (visible.length) {
    $("#slotTable").innerHTML = visible
      .map((slot) => {
        const pickPct = (slot.pickCount / max) * 100;
        const sortPct = (slot.sortCount / max) * 100;
        const totalQtyEach = slot.pickQtyEach + slot.sortQtyEach;
        const totalQtyPack = slot.pickQtyPack + slot.sortQtyPack;
        const totalCount = slot.pickCount + slot.sortCount;
        return `
          <tr title="Slot ${slot.label}&#10;• Pick: ${fmt.format(slot.pickCount)} รายการ | ${fmt.format(slot.pickQtyEach)} ชิ้น | ${fmt.format(slot.pickQtyPack)} แพ็ค&#10;• Sort: ${fmt.format(slot.sortCount)} รายการ | ${fmt.format(slot.sortQtyEach)} ชิ้น | ${fmt.format(slot.sortQtyPack)} แพ็ค">
            <td><span class="tag">${slot.label}</span></td>
            <td>
              <div class="bar-track" style="margin: 0; width: 100%; min-width: 100px;">
                <div class="bar-pair">
                  <div class="bar-pick" style="width:${pickPct}%"></div>
                  <div class="bar-sort" style="width:${sortPct}%"></div>
                </div>
              </div>
            </td>
            <td class="num">${fmt.format(totalQtyEach)}</td>
            <td class="num">${fmt.format(totalQtyPack)}</td>
          </tr>`;
      })
      .join("");
    $("#slotLegend").innerHTML = `<span><i style="background:var(--teal)"></i>Pick</span><span><i style="background:var(--indigo)"></i>Sort</span>`;
    $("#slotLegend").style.display = "";
  } else {
    $("#slotTable").innerHTML = `<tr><td colspan="4" class="empty">ไม่มีข้อมูล</td></tr>`;
    $("#slotLegend").style.display = "none";
  }
}

function employeeSummary(rows, mode) {
  const workerKey = mode === "pick" ? "picker" : "sorter";
  const timeKey = mode === "pick" ? "pick" : "sort";
  const completedRows = rows.filter((row) => row[workerKey].code && row[timeKey].at);
  
  return [...groupBy(completedRows, (row) => row[workerKey].code).entries()]
    .map(([, items]) => {
      const worker = items[0][workerKey];
      const days = groupBy(items, rowDate);
      let activeMinutes = 0;
      days.forEach((dayRows) => {
        const times = dayRows.map((row) => toMs(row[timeKey].at)).filter(Boolean);
        if (!times.length) return;
        const span = (Math.max(...times) - Math.min(...times)) / 60000;
        activeMinutes += Math.max(span, dayRows.length > 1 ? 10 : 5);
      });
      const activeHours = activeMinutes / 60;
      const qtyEach = sumBy(items, "qtyEach");
      const qtyPack = sumBy(items, "qtyPack");
      return {
        worker,
        qtyEach,
        qtyPack,
        waves: uniqueCount(items, (row) => row.wave),
        activeHours,
        rateEach: activeHours ? qtyEach / activeHours : null,
        avgCycle: mean(items.map((row) => row.cycleMinutes)),
      };
    })
    .sort((a, b) => (b.rateEach || 0) - (a.rateEach || 0) || b.qtyEach - a.qtyEach || b.waves - a.waves)
    .slice(0, 18);
}

function renderPeople(rows) {
  const people = employeeSummary(rows, state.peopleMode);
  $("#peopleHint").textContent = state.peopleMode === "pick" ? "จัดอันดับ Pick ตามชิ้น/hr" : "จัดอันดับ Sort ตามชิ้น/hr";
  if (!people.length) {
    $("#peopleTable").innerHTML = `<tr><td colspan="7" class="empty">ไม่มีข้อมูล</td></tr>`;
    return;
  }
  const maxRate = Math.max(...people.map(p => p.rateEach || 0), 1);
  const medals  = ["🥇", "🥈", "🥉"];
  $("#peopleTable").innerHTML = people.map((person, idx) => {
    const label   = person.worker.nick || person.worker.name || person.worker.code || "-";
    const rate    = person.rateEach || 0;
    const barPct  = (rate / maxRate) * 100;
    const rateClass = rate >= maxRate * 0.8 ? "rate-high"
                    : rate >= maxRate * 0.5 ? "rate-mid"
                    : "rate-low";
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
        <td class="num">
          <div class="rate-cell">
            <span class="rate-value ${rateClass}">${rate ? fmt1.format(rate) : "-"}</span>
            <div class="rate-bar-wrap"><div class="rate-bar ${rateClass}" style="width:${barPct}%"></div></div>
          </div>
        </td>
        <td class="num">${metricMinutes(person.avgCycle)}</td>
      </tr>`;
  }).join("");
}

function waveSummary(rows) {
  return [...groupBy(rows, (row) => row.wave).entries()]
    .map(([wave, items]) => {
      let pickStart = null;
      let pickEnd = null;
      let sortStart = null;
      let sortEnd = null;
      for (const item of items) {
        if (item.pick.at) {
          if (!pickStart || item.pick.at < pickStart) pickStart = item.pick.at;
          if (!pickEnd || item.pick.at > pickEnd) pickEnd = item.pick.at;
        }
        if (item.sort.at) {
          if (!sortStart || item.sort.at < sortStart) sortStart = item.sort.at;
          if (!sortEnd || item.sort.at > sortEnd) sortEnd = item.sort.at;
        }
      }
      return {
        wave,
        date: rowDate(items[0]),
        qtyPack: sumBy(items, "qtyPack"),
        pickDuration: minutesBetween(pickStart, pickEnd),
        sortDuration: minutesBetween(sortStart, sortEnd),
        avgCycle: mean(items.map((row) => row.cycleMinutes)),
      };
    })
    .sort((a, b) => b.qtyPack - a.qtyPack)
    .slice(0, 18);
}

function renderWaves(rows) {
  const waves = waveSummary(rows);
  $("#waveHint").textContent = `${fmt.format(uniqueCount(rows, (row) => row.wave))} waves`;
  if (!waves.length) {
    $("#waveTable").innerHTML = `<tr><td colspan="6" class="empty">ไม่มีข้อมูล</td></tr>`;
    return;
  }
  const maxPack = Math.max(...waves.map(w => w.qtyPack), 1);
  $("#waveTable").innerHTML = waves.map((wave) => {
    const packPct = (wave.qtyPack / maxPack) * 100;
    const cyc     = wave.avgCycle;
    const cycClass = cyc === null ? "" : cyc <= 5 ? "cycle-fast" : cyc <= 15 ? "cycle-mid" : "cycle-slow";
    const dateStr  = wave.date ? wave.date.slice(5).replace("-", "/") : "-";
    return `
      <tr>
        <td><span class="tag tag-wave">${html(wave.wave || "-")}</span></td>
        <td><span class="date-cell">${html(dateStr)}</span></td>
        <td class="num">
          <div class="pack-cell">
            <span>${fmt.format(wave.qtyPack)}</span>
            <div class="pack-bar-wrap"><div class="pack-bar" style="width:${packPct}%"></div></div>
          </div>
        </td>
        <td class="num">${metricMinutes(wave.pickDuration)}</td>
        <td class="num">${metricMinutes(wave.sortDuration)}</td>
        <td class="num"><span class="cycle-badge ${cycClass}">${metricMinutes(cyc)}</span></td>
      </tr>`;
  }).join("");
}

function renderSlowRows(rows) {
  const sorted = rows
    .filter((row) => row.pick.at)
    .sort((a, b) => b.pick.at.localeCompare(a.pick.at))
    .slice(0, 24);
  $("#slowHint").textContent = "เรียงจาก Pick ล่าสุด";
  if (!sorted.length) {
    $("#slowTable").innerHTML = `<tr><td colspan="10" class="empty">ไม่มีข้อมูล</td></tr>`;
    return;
  }
  $("#slowTable").innerHTML = sorted.map((row) => {
    const cyc      = row.cycleMinutes;
    const cycClass = cyc === null ? "" : cyc <= 5 ? "cycle-fast" : cyc <= 15 ? "cycle-mid" : "cycle-slow";
    const pickTime = [row.pick.date ? row.pick.date.slice(5).replace("-", "/") : "", row.pick.time || ""].filter(Boolean).join(" ");
    const sortTime = [row.sort.date ? row.sort.date.slice(5).replace("-", "/") : "", row.sort.time || ""].filter(Boolean).join(" ");
    return `
      <tr>
        <td><span class="tag tag-wave">${html(row.wave || "-")}</span></td>
        <td><span class="tag tag-${row.shift?.group || 'unknown'}">${html(row.shift?.shortLabel || "-")}</span></td>
        <td><span class="date-cell">${html(rowDate(row) ? rowDate(row).slice(5).replace("-","/") : "-")}</span></td>
        <td class="item-cell">${html(row.item || "-")}</td>
        <td class="num"><strong>${fmt.format(row.qtyEach)}</strong></td>
        <td>${displayWorkerCompact(row.picker)}</td>
        <td>${displayWorkerCompact(row.sorter)}</td>
        <td class="num time-cell">${html(pickTime || "-")}</td>
        <td class="num time-cell">${sortTime ? html(sortTime) : '<span class="missing">ยังไม่ได้ Sort</span>'}</td>
        <td class="num"><span class="cycle-badge ${cycClass}">${metricMinutes(cyc)}</span></td>
      </tr>`;
  }).join("");
}

function displayWorkerCompact(worker) {
  if (!worker || !worker.code) return '<span class="missing">-</span>';
  const label = worker.nick || worker.name || worker.code;
  return `<span class="worker-compact"><strong>${html(label)}</strong> <small>${html(worker.code)}</small></span>`;
}

function exportCsv(rows) {
  const header = [
    "wave",
    "shift_date",
    "shift_group",
    "shift_name",
    "shift_window",
    "item",
    "qty_each",
    "qty_pack",
    "picker_code",
    "picker_nick",
    "sorter_code",
    "sorter_nick",
    "pick_date",
    "pick_time",
    "pick_slot",
    "sort_date",
    "sort_time",
    "sort_slot",
    "cycle_minutes",
  ];
  const lines = rows.map((row) =>
    [
      row.wave,
      row.shift?.date || "",
      row.shift?.group || "",
      row.shift?.label || "",
      row.shift?.window || "",
      row.item,
      row.qtyEach,
      row.qtyPack,
      row.picker.code,
      row.picker.nick,
      row.sorter.code,
      row.sorter.nick,
      row.pick.date,
      row.pick.time,
      row.pick.slot,
      row.sort.date,
      row.sort.time,
      row.sort.slot,
      row.cycleMinutes ?? "",
    ]
      .map((value) => `"${String(value).replaceAll('"', '""')}"`)
      .join(",")
  );
  const blob = new Blob([`\ufeff${header.join(",")}\n${lines.join("\n")}`], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "pick-to-sort-filtered.csv";
  a.click();
  URL.revokeObjectURL(url);
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
    const date = rowDate(record);
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
    const date = rowDate(record);
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

function render() {
  const rows = filteredRecords();
  const shiftRows = filteredRecords({ ignoreShift: true });
  const prevRows = previousPeriodRecords();
  const prevShiftRows = prevRows; // same set, ignoring shift filter
  
  const dailyRows = filteredDailyRecords();

  renderKpis(rows, prevRows);
  renderDayNightSummary(shiftRows, prevShiftRows);
  renderDailyChart(dailyRows);

  function renderDayNightSummary(rows, prevRows) {
    const hint = $("#dayNightHint");
    const spanDays = (state.dateFrom && state.dateTo)
      ? Math.round((new Date(state.dateTo) - new Date(state.dateFrom)) / 86400000) + 1
      : 1;
    const prevLabel = spanDays === 1 ? "vs เมื่อวาน" : `vs ${spanDays} วันก่อน`;
    if (hint) hint.textContent = `สรุปยอดแยกตาม DAY และ NIGHT  ·  ${prevLabel}`;

    const container = $("#dayNightCards");
    if (!container) return;

    const groups = [
      { key: "day",   label: "DAY",   emoji: "☀️",  colorClass: "shift-day" },
      { key: "night", label: "NIGHT", emoji: "🌙",  colorClass: "shift-night" },
    ];

    const total = { qtyEach: sumBy(rows, "qtyEach"), qtyPack: sumBy(rows, "qtyPack") };

    container.innerHTML = groups.map((g) => {
      // current
      const items        = rows.filter((r) => r.shift?.group === g.key);
      const totalQtyEach = sumBy(items, "qtyEach");
      const totalQtyPack = sumBy(items, "qtyPack");
      const sorted       = items.filter((r) => r.sort?.at).length;
      const sortedRate   = items.length ? (sorted / items.length) * 100 : 0;
      const avgCycle     = mean(items.map((r) => r.cycleMinutes));
      const workers      = uniqueCount(items, (r) => r.picker.code) + uniqueCount(items, (r) => r.sorter.code);
      const pct          = total.qtyEach ? (totalQtyEach / total.qtyEach) * 100 : 0;

      // previous
      const pItems        = prevRows.filter((r) => r.shift?.group === g.key);
      const pQtyEach      = pItems.length ? sumBy(pItems, "qtyEach")  : null;
      const pQtyPack      = pItems.length ? sumBy(pItems, "qtyPack")  : null;
      const pSorted       = pItems.filter((r) => r.sort?.at).length;
      const pSortedRate   = pItems.length ? (pSorted / pItems.length) * 100 : null;
      const pAvgCycle     = pItems.length ? mean(pItems.map((r) => r.cycleMinutes)) : null;
      const pWorkers      = pItems.length
        ? uniqueCount(pItems, (r) => r.picker.code) + uniqueCount(pItems, (r) => r.sorter.code)
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
              <div class="shift-stat-value">${items.length ? fmt1.format(sortedRate) + "<span class='shift-stat-unit'>%</span>" : "–"}</div>
              <div class="shift-stat-label">Sort สำเร็จ</div>
              ${hasPrev && pSortedRate !== null ? deltaHtml(sortedRate, pSortedRate) : ""}
              ${hasPrev && pSortedRate !== null ? `<div class="shift-stat-prev">${fmt1.format(pSortedRate)}%</div>` : ""}
            </div>
            <div class="shift-stat">
              <div class="shift-stat-value">${avgCycle !== null ? `${fmt1.format(avgCycle)}<span class='shift-stat-unit'>นาที</span>` : "–"}</div>
              <div class="shift-stat-label">เฉลี่ย Pick→Sort</div>
              ${hasPrev && pAvgCycle !== null ? deltaHtml(avgCycle, pAvgCycle, true) : ""}
              ${hasPrev && pAvgCycle !== null ? `<div class="shift-stat-prev">${fmt1.format(pAvgCycle)} นาที</div>` : ""}
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
  renderSlots(rows);
  renderWaves(rows);
  renderSlowRows(rows);
  renderQuality(rows);
  syncMenu();
  
  $("#metaRows").textContent = `${fmt.format(records.length)} รายการ`;
  
  $("#metaLatestJob").textContent = `ข้อมูลล่าสุด: ${sourceMeta.generatedAt || "-"}`;

  $("#exportBtn").disabled = isLoading || !rows.length;
}

function renderDailyDayNight(rows) {
  const hint = $("#dayNightByDateHint");
  if (hint) hint.textContent = "ยอดรวมต่อวัน แยก DAY / NIGHT";

  const groupsByDate = new Map();
  rows.forEach((r) => {
    const date = rowDate(r) || "(ไม่มีวันที่)";
    if (!groupsByDate.has(date)) groupsByDate.set(date, []);
    groupsByDate.get(date).push(r);
  });

  const dates = [...groupsByDate.keys()].sort((a, b) => a.localeCompare(b));
  let totalDay = 0;
  let totalNight = 0;

  const lines = dates
    .map((date) => {
      const items = groupsByDate.get(date) || [];
      const dayQty = sumBy(items.filter((x) => x.shift?.group === "day"), "qtyEach");
      const nightQty = sumBy(items.filter((x) => x.shift?.group === "night"), "qtyEach");
      const unassignedQty = sumBy(items.filter((x) => !x.shift || (x.shift?.group !== "day" && x.shift?.group !== "night")), "qtyEach");
      const total = dayQty + nightQty + unassignedQty; // Keep total math correct in case there are unassigned ones so total matches overall

      totalDay += dayQty;
      totalNight += nightQty;

      const note = total === 0 ? "-" : `${fmt1.format((dayQty / total) * 100 || 0)}% / ${fmt1.format((nightQty / total) * 100 || 0)}%`;
      return `
        <tr>
          <td>${html(date)}</td>
          <td class="num col-day">${fmt.format(dayQty)}</td>
          <td class="num col-night">${fmt.format(nightQty)}</td>
          <td class="num col-total">${fmt.format(total)}</td>
          <td class="num">${html(note)}</td>
        </tr>`;
    })
    .join("");

  const table = $("#dayNightByDateTable");
  if (!table) return;
  if (!lines) {
    table.innerHTML = `<tr><td colspan="5" class="empty">ไม่มีข้อมูล</td></tr>`;
    return;
  }

  // Need to calculate grand total across all rows for the overall total column, to ensure it doesn't just sum day+night if there are hidden unassigned items
  const overallTotalEach = sumBy(rows, "qtyEach");
  
  const footer = `
    <tr class="group-header">
      <td><strong>รวม</strong></td>
      <td class="num col-day"><strong>${fmt.format(totalDay)}</strong></td>
      <td class="num col-night"><strong>${fmt.format(totalNight)}</strong></td>
      <td class="num col-total"><strong>${fmt.format(overallTotalEach)}</strong></td>
      <td class="num"><strong>${fmt1.format((totalDay / (overallTotalEach || 1)) * 100)}% / ${fmt1.format((totalNight / (overallTotalEach || 1)) * 100)}%</strong></td>
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
    const staffPromise = loadStaffLookup().catch((error) => {
      const fallbackCount = Object.keys(staffLookup).length;
      if (fallbackCount) {
        console.info("ใช้รายชื่อสำรองจาก data.js เพราะโหลดชีตรายชื่อสดไม่ได้", error);
      } else {
        console.warn(error);
      }
      return {
        lookup: staffLookup,
        count: fallbackCount,
        error: error.message || "โหลดรายชื่อไม่สำเร็จ",
        fallback: fallbackCount > 0,
      };
    });
    const [payload, loadedStaff] = await Promise.all([loadSheetViaJsonp(), staffPromise]);
    staffLookup = loadedStaff.lookup || {};
    staffMeta = {
      loaded: !loadedStaff.error,
      count: loadedStaff.count || Object.keys(staffLookup).length,
      error: loadedStaff.error || "",
      fallback: Boolean(loadedStaff.fallback),
    };
    msCache.clear();
    const rawRows = rowsFromGviz(payload);
    const result = normalizeRecords(rawRows);
    records = result.records;
    sourceMeta = deriveMeta(records, result.skippedRows);
    syncDateControls(!keepFilters);
    render();
    setStatus("", "");
  } catch (error) {
    console.error(error);
    setStatus(error.message || "โหลดข้อมูลไม่สำเร็จ", "error");
    render();
  } finally {
    setLoading(false);
  }
}

function initEvents() {
  document.querySelectorAll("[data-menu-tab]").forEach((button) => {
    button.addEventListener("click", () => {
      state.activeMenu = button.dataset.menuTab || "overview";
      syncMenu();
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
  $("#exportBtn").addEventListener("click", () => exportCsv(filteredRecords()));
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
