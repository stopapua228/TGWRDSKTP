import json
import os
import re
import sqlite3
import statistics
import sys
import threading
from collections import Counter, defaultdict
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from html import unescape
from html.parser import HTMLParser
from typing import Any, Dict, Iterable, List, Optional, Tuple

VERSION = "0.1.0"

_STDOUT_LOCK = threading.Lock()
_CANCEL_EVENT = threading.Event()
_IMPORT_LOCK = threading.Lock()
_IMPORT_THREAD: Optional[threading.Thread] = None

_REPORT_LOCK = threading.Lock()
_REPORT_THREAD: Optional[threading.Thread] = None


class CancelledError(Exception):
    pass


def write_json(obj: Dict[str, Any]) -> None:
    line = json.dumps(obj, ensure_ascii=False)
    with _STDOUT_LOCK:
        sys.stdout.write(line + "\n")
        sys.stdout.flush()


def progress(stage: str, percent: int, current_chat: str = "", current_file: str = "") -> None:
    p = max(0, min(100, int(percent)))
    write_json(
        {
            "type": "progress",
            "stage": stage,
            "percent": p,
            "current_chat": current_chat,
            "current_file": current_file,
        }
    )


def _moscow_tzinfo() -> Any:
    try:
        from zoneinfo import ZoneInfo  # type: ignore

        return ZoneInfo("Europe/Moscow")
    except Exception:
        return timezone(timedelta(hours=3))


def parse_date_to_unix_seconds(date_value: Any) -> int:
    """
    Telegram JSON export 'date' is ISO string (often without timezone).
    We always interpret naive datetimes as MSK (Europe/Moscow).
    """
    if not isinstance(date_value, str) or not date_value:
        return 0

    s = date_value.strip()
    try:
        dt = datetime.fromisoformat(s.replace("Z", "+00:00"))
    except Exception:
        # Fallback common formats
        for fmt in ("%Y-%m-%dT%H:%M:%S", "%Y-%m-%d %H:%M:%S"):
            try:
                dt = datetime.strptime(s, fmt)
                break
            except Exception:
                dt = None  # type: ignore
        if dt is None:
            return 0

    msk = _moscow_tzinfo()
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=msk)
        return int(dt.timestamp())

    try:
        return int(dt.astimezone(msk).timestamp())
    except Exception:
        return int(dt.timestamp())


def parse_html_title_datetime_to_unix_seconds(title_value: Optional[str]) -> int:
    """
    Telegram HTML export date usually stored in:
      <div class="pull_right date details" title="15.04.2022 17:12:34 UTC+03:00">...</div>
    We interpret it as MSK (Europe/Moscow) regardless.
    """
    if not title_value:
        return 0
    s = title_value.strip()
    s = re.sub(r"\s*UTC[+-]\d{1,2}:\d{2}\s*$", "", s)
    s = re.sub(r"\s*UTC[+-]\d{1,2}\s*$", "", s)
    s = s.strip()

    msk = _moscow_tzinfo()

    for fmt in ("%d.%m.%Y %H:%M:%S", "%d.%m.%Y %H:%M", "%Y-%m-%d %H:%M:%S", "%Y-%m-%d %H:%M"):
        try:
            dt = datetime.strptime(s, fmt)
            dt = dt.replace(tzinfo=msk)
            return int(dt.timestamp())
        except Exception:
            continue

    try:
        dt2 = datetime.fromisoformat(s)
        if dt2.tzinfo is None:
            dt2 = dt2.replace(tzinfo=msk)
        else:
            dt2 = dt2.astimezone(msk)
        return int(dt2.timestamp())
    except Exception:
        return 0


def flatten_text(text_value: Any) -> str:
    if text_value is None:
        return ""
    if isinstance(text_value, str):
        return text_value
    if isinstance(text_value, list):
        parts: List[str] = []
        for item in text_value:
            if isinstance(item, str):
                parts.append(item)
            elif isinstance(item, dict):
                t = item.get("text")
                if isinstance(t, str):
                    parts.append(t)
                elif isinstance(t, list):
                    parts.append(flatten_text(t))
        return "".join(parts)
    if isinstance(text_value, dict):
        t = text_value.get("text")
        if isinstance(t, str):
            return t
        if isinstance(t, list):
            return flatten_text(t)
    return ""


def normalize_from_id(from_id_value: Any) -> Optional[str]:
    if from_id_value is None:
        return None
    if isinstance(from_id_value, bool):
        return None
    if isinstance(from_id_value, int):
        return str(from_id_value)
    if isinstance(from_id_value, float):
        if from_id_value.is_integer():
            return str(int(from_id_value))
        return str(from_id_value)
    if isinstance(from_id_value, str):
        return from_id_value
    return str(from_id_value)


def extract_numeric_id(from_id_text: Optional[str]) -> Optional[int]:
    if not from_id_text:
        return None
    s = from_id_text.strip()
    if s.isdigit():
        try:
            return int(s)
        except Exception:
            return None
    if s.startswith("user") and s[4:].isdigit():
        try:
            return int(s[4:])
        except Exception:
            return None
    if s.startswith("-") and s[1:].isdigit():
        try:
            return int(s)
        except Exception:
            return None
    return None


def is_chat_export_json(obj: Any) -> bool:
    return isinstance(obj, dict) and "name" in obj and "type" in obj and "messages" in obj


def derive_export_chat_id(chat_obj: Dict[str, Any], file_path: str, export_dir: str) -> str:
    cid = chat_obj.get("id")
    if cid is not None:
        return str(cid)

    try:
        rel_dir = os.path.relpath(os.path.dirname(file_path), export_dir)
    except Exception:
        rel_dir = os.path.dirname(file_path)

    if rel_dir in (".", ""):
        try:
            return os.path.relpath(file_path, export_dir)
        except Exception:
            return file_path
    return rel_dir


def ensure_removed(path: str) -> None:
    try:
        os.remove(path)
    except FileNotFoundError:
        return
    except Exception:
        return


def recreate_db(db_path: str) -> sqlite3.Connection:
    parent = os.path.dirname(db_path)
    if parent:
        os.makedirs(parent, exist_ok=True)

    ensure_removed(db_path)
    ensure_removed(db_path + "-wal")
    ensure_removed(db_path + "-shm")

    conn = sqlite3.connect(db_path)
    conn.execute("PRAGMA journal_mode=WAL;")
    conn.execute("PRAGMA synchronous=NORMAL;")
    conn.execute("PRAGMA temp_store=MEMORY;")
    conn.execute("PRAGMA cache_size=-64000;")
    conn.execute("PRAGMA foreign_keys=OFF;")

    conn.execute(
        """
        CREATE TABLE chats (
          chat_pk INTEGER PRIMARY KEY AUTOINCREMENT,
          export_chat_id TEXT,
          name TEXT,
          type TEXT,
          peer_from_id TEXT NULL
        );
        """
    )

    conn.execute(
        """
        CREATE TABLE meta (
          key TEXT PRIMARY KEY,
          value TEXT
        );
        """
    )

    conn.execute(
        """
        CREATE TABLE messages (
          msg_pk INTEGER PRIMARY KEY AUTOINCREMENT,
          chat_pk INTEGER,
          msg_id TEXT,
          date_ts INTEGER,
          from_id TEXT,
          from_name TEXT,
          text TEXT,
          media_type TEXT NULL,
          sticker_emoji TEXT NULL,
          is_out INTEGER DEFAULT 0,
          is_edited INTEGER DEFAULT 0,
          is_service INTEGER DEFAULT 0,
          reply_to_msg_id TEXT NULL
        );
        """
    )

    return conn


def create_indexes(conn: sqlite3.Connection) -> None:
    conn.execute("CREATE INDEX idx_messages_chat_date ON messages(chat_pk, date_ts);")
    conn.execute("CREATE INDEX idx_messages_from_date ON messages(from_id, date_ts);")
    conn.execute("CREATE INDEX idx_messages_chat_out_date ON messages(chat_pk, is_out, date_ts);")
    conn.execute("CREATE INDEX idx_chats_peer ON chats(peer_from_id);")


MSK_OFFSET_SECONDS = 3 * 60 * 60


def _get_table_columns(conn: sqlite3.Connection, table: str) -> List[str]:
    try:
        rows = conn.execute(f"PRAGMA table_info({table});").fetchall()
        cols: List[str] = []
        for r in rows:
            # PRAGMA table_info returns: cid, name, type, notnull, dflt_value, pk
            name = None
            try:
                name = r[1]  # works for tuples and sqlite3.Row
            except Exception:
                try:
                    name = r["name"]
                except Exception:
                    name = None
            if isinstance(name, str):
                cols.append(name)
        return cols
    except Exception:
        return []


def ensure_schema(conn: sqlite3.Connection) -> None:
    """Best-effort schema migration for older DBs."""

    # meta table
    try:
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS meta (
              key TEXT PRIMARY KEY,
              value TEXT
            );
            """
        )
    except Exception:
        pass

    # chats.peer_from_id
    chat_cols = set(_get_table_columns(conn, "chats"))
    if "peer_from_id" not in chat_cols:
        try:
            conn.execute("ALTER TABLE chats ADD COLUMN peer_from_id TEXT NULL;")
        except Exception:
            pass

    # messages.is_out + sticker_emoji
    msg_cols = set(_get_table_columns(conn, "messages"))
    if "is_out" not in msg_cols:
        try:
            conn.execute("ALTER TABLE messages ADD COLUMN is_out INTEGER DEFAULT 0;")
        except Exception:
            pass
    if "sticker_emoji" not in msg_cols:
        try:
            conn.execute("ALTER TABLE messages ADD COLUMN sticker_emoji TEXT NULL;")
        except Exception:
            pass


def meta_get(conn: sqlite3.Connection, key: str) -> Optional[str]:
    try:
        row = conn.execute("SELECT value FROM meta WHERE key = ?;", (key,)).fetchone()
        if row is None:
            return None
        val = row[0]
        return val if isinstance(val, str) else (str(val) if val is not None else None)
    except Exception:
        return None


def meta_set(conn: sqlite3.Connection, key: str, value: str) -> None:
    try:
        conn.execute(
            """
            INSERT INTO meta(key, value) VALUES (?, ?)
            ON CONFLICT(key) DO UPDATE SET value = excluded.value;
            """,
            (key, value),
        )
    except Exception:
        # Older SQLite versions might not support upsert; fallback.
        try:
            conn.execute("DELETE FROM meta WHERE key = ?;", (key,))
            conn.execute("INSERT INTO meta(key, value) VALUES (?, ?);", (key, value))
        except Exception:
            pass


def compute_self_from_id(conn: sqlite3.Connection) -> Optional[str]:
    """Pick from_id that appears in the largest number of unique chats."""
    try:
        row = conn.execute(
            """
            SELECT from_id,
                   COUNT(DISTINCT chat_pk) AS chat_cnt,
                   COUNT(*) AS msg_cnt
            FROM messages
            WHERE from_id IS NOT NULL AND TRIM(from_id) != ''
            GROUP BY from_id
            ORDER BY chat_cnt DESC, msg_cnt DESC
            LIMIT 1;
            """
        ).fetchone()
        if row is None:
            return None
        fid = row[0]
        return fid if isinstance(fid, str) and fid.strip() else (str(fid) if fid is not None else None)
    except Exception:
        return None


def apply_direction_updates(conn: sqlite3.Connection, self_from_id: Optional[str]) -> None:
    """Fill messages.is_out and chats.peer_from_id. Best-effort."""
    ensure_schema(conn)
    try:
        conn.execute("BEGIN;")
    except Exception:
        pass

    try:
        if not self_from_id:
            conn.execute("UPDATE messages SET is_out = 0;")
            conn.execute("UPDATE chats SET peer_from_id = NULL;")
            meta_set(conn, "self_from_id", "")
        else:
            meta_set(conn, "self_from_id", self_from_id)
            conn.execute(
                "UPDATE messages SET is_out = CASE WHEN from_id = ? OR from_id = '__self__' THEN 1 ELSE 0 END;",
                (self_from_id,),
            )
            conn.execute(
                """
                UPDATE chats
                SET peer_from_id = (
                  SELECT m.from_id
                  FROM messages m
                  WHERE m.chat_pk = chats.chat_pk
                    AND m.from_id IS NOT NULL
                    AND TRIM(m.from_id) != ''
                    AND m.from_id != ?
                  GROUP BY m.from_id
                  ORDER BY COUNT(*) DESC
                  LIMIT 1
                )
                WHERE peer_from_id IS NULL OR TRIM(peer_from_id) = '';
                """,
                (self_from_id,),
            )

        try:
            conn.execute("COMMIT;")
        except Exception:
            conn.commit()
    except CancelledError:
        try:
            conn.execute("ROLLBACK;")
        except Exception:
            pass
        raise
    except Exception:
        try:
            conn.execute("ROLLBACK;")
        except Exception:
            pass


def compute_db_total_size_bytes(db_path: str) -> int:
    total = 0
    for p in (db_path, db_path + "-wal", db_path + "-shm"):
        try:
            if os.path.exists(p):
                total += os.path.getsize(p)
        except Exception:
            continue
    return total


def normalize_name(name: str) -> str:
    s = name.strip().lower()
    s = re.sub(r"\s+", " ", s)
    return s


def counts_similar(a: int, b: int) -> bool:
    if a <= 0 or b <= 0:
        return a == b
    m = max(a, b)
    tol = max(50, int(0.20 * m))
    return abs(a - b) <= tol


@dataclass
class ChatCandidate:
    source: str  # json | result | html
    priority: int
    export_chat_id: str
    name: str
    type: str
    approx_msgs: int
    json_files: List[str] = field(default_factory=list)
    json_file_msg_counts: Dict[str, int] = field(default_factory=dict)
    result_origin_file: Optional[str] = None
    result_chat_obj: Optional[Dict[str, Any]] = None
    html_files: List[str] = field(default_factory=list)
    html_file_msg_counts: Dict[str, int] = field(default_factory=dict)
    chat_pk: Optional[int] = None


@dataclass
class Unit:
    kind: str  # json_file | result_chat | html_file
    file_path: str
    chat: ChatCandidate
    est_msgs: int


def scan_export_dir(export_dir: str) -> Tuple[List[str], List[str], List[str]]:
    """
    Returns (json_files_excluding_result, result_json_files, html_message_files)
    """
    json_files: List[str] = []
    result_files: List[str] = []
    html_files: List[str] = []

    for root, _dirs, files in os.walk(export_dir):
        if _CANCEL_EVENT.is_set():
            raise CancelledError()
        for fn in files:
            lower = fn.lower()
            p = os.path.join(root, fn)
            if lower.endswith(".json"):
                if lower == "result.json":
                    result_files.append(p)
                else:
                    json_files.append(p)
            elif lower.endswith(".html") and lower.startswith("messages"):
                html_files.append(p)

    json_files.sort()
    result_files.sort()
    html_files.sort()
    return json_files, result_files, html_files


def load_json_safely(path: str) -> Optional[Any]:
    try:
        with open(path, "r", encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return None


def strip_tags_simple(html_fragment: str) -> str:
    s = re.sub(r"<br\s*/?>", "\n", html_fragment, flags=re.IGNORECASE)
    s = re.sub(r"<[^>]+>", "", s)
    return unescape(s).strip()


def extract_html_chat_title(file_path: str) -> str:
    try:
        with open(file_path, "r", encoding="utf-8", errors="ignore") as f:
            chunk = f.read(262144)
    except Exception:
        return ""

    idx = chunk.find('<div class="message')
    header = chunk if idx < 0 else chunk[:idx]

    m = re.search(r'<div class="text bold"\s*>\s*(.*?)\s*</div>', header, flags=re.DOTALL | re.IGNORECASE)
    if m:
        return strip_tags_simple(m.group(1))

    m2 = re.search(r"<title>\s*(.*?)\s*</title>", header, flags=re.DOTALL | re.IGNORECASE)
    if m2:
        return strip_tags_simple(m2.group(1))

    return ""


def count_html_messages(file_path: str) -> int:
    cnt = 0
    try:
        with open(file_path, "r", encoding="utf-8", errors="ignore") as f:
            for line in f:
                if _CANCEL_EVENT.is_set():
                    raise CancelledError()
                cnt += line.count('<div class="message')
    except CancelledError:
        raise
    except Exception:
        return 0
    return cnt


class TgHtmlMsgParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.msg_id: Optional[str] = None
        self.date_title: Optional[str] = None
        self.date_ts: Optional[int] = None
        self.from_name: str = ""
        self.text: str = ""
        self.body_details_text: str = ""
        self.is_service: int = 0
        self.is_edited: int = 0
        self.is_out: int = 0
        self.reply_to_msg_id: Optional[str] = None
        self.media_type: Optional[str] = None

        self._div_stack: List[str] = []
        self._from_depth = 0
        self._text_depth = 0
        self._reply_depth = 0
        self._body_details_depth = 0
        self._captured_main_text = False

        self._media_pri = 0

    def _set_media(self, media: str, pri: int) -> None:
        if pri > self._media_pri:
            self.media_type = media
            self._media_pri = pri

    def handle_starttag(self, tag: str, attrs: List[Tuple[str, Optional[str]]]) -> None:
        attrs_dict: Dict[str, str] = {}
        for k, v in attrs:
            if v is None:
                continue
            attrs_dict[k] = v

        cls_any = attrs_dict.get("class", "")
        class_any = cls_any.split()
        if "photo_wrap" in class_any or "photo" in class_any:
            self._set_media("photo", 2)
        elif "video_wrap" in class_any or "video_file" in class_any:
            self._set_media("video", 2)
        elif "voice_wrap" in class_any:
            self._set_media("voice", 2)
        elif "sticker_wrap" in class_any or "sticker" in class_any:
            self._set_media("sticker", 2)
        elif "gif_wrap" in class_any:
            self._set_media("gif", 2)
        elif "document_wrap" in class_any or "file_wrap" in class_any:
            self._set_media("file", 2)
        elif "media_wrap" in class_any:
            self._set_media("other", 1)

        if tag == "div":
            cls = attrs_dict.get("class", "")
            class_list = cls.split()
            marker = ""

            if "message" in class_list and self.msg_id is None:
                mid = attrs_dict.get("id", "")
                if mid.startswith("message"):
                    self.msg_id = mid[len("message") :]
                if "service" in class_list:
                    self.is_service = 1
                if "out" in class_list:
                    self.is_out = 1

            if "pull_right" in class_list and "date" in class_list and "details" in class_list:
                t = attrs_dict.get("title")
                if t:
                    self.date_title = t
                ts = attrs_dict.get("data-timestamp")
                if ts and ts.isdigit():
                    try:
                        self.date_ts = int(ts)
                    except Exception:
                        self.date_ts = None

            if "reply_to" in class_list and "details" in class_list:
                marker = "reply_to"
                self._reply_depth += 1

            if "from_name" in class_list:
                marker = "from_name"
                self._from_depth += 1

            if "body" in class_list and "details" in class_list:
                marker = "body_details"
                self._body_details_depth += 1

            if "text" in class_list:
                if self._reply_depth == 0 and not self._captured_main_text:
                    marker = "main_text"
                    self._text_depth += 1

            self._div_stack.append(marker)

        elif tag == "a":
            href = attrs_dict.get("href", "")
            if href:
                m = re.search(r"go_to_message(\d+)", href)
                if m:
                    self.reply_to_msg_id = m.group(1)

        elif tag == "span":
            cls = attrs_dict.get("class", "")
            if "edited" in cls.split():
                self.is_edited = 1

        elif tag == "br":
            if self._text_depth > 0:
                self.text += "\n"
            elif self._body_details_depth > 0:
                self.body_details_text += "\n"
            elif self._from_depth > 0:
                self.from_name += "\n"

    def handle_endtag(self, tag: str) -> None:
        if tag == "div":
            if self._div_stack:
                marker = self._div_stack.pop()
                if marker == "from_name":
                    self._from_depth = max(0, self._from_depth - 1)
                elif marker == "main_text":
                    self._text_depth = max(0, self._text_depth - 1)
                    if self._text_depth == 0:
                        self._captured_main_text = True
                elif marker == "reply_to":
                    self._reply_depth = max(0, self._reply_depth - 1)
                elif marker == "body_details":
                    self._body_details_depth = max(0, self._body_details_depth - 1)

    def handle_data(self, data: str) -> None:
        if not data:
            return
        if self._from_depth > 0:
            self.from_name += data
        if self._text_depth > 0:
            self.text += data
        if self._body_details_depth > 0:
            self.body_details_text += data


def iter_html_message_blocks(file_path: str) -> Iterable[str]:
    start_marker = '<div class="message'
    buf: Optional[List[str]] = None
    try:
        with open(file_path, "r", encoding="utf-8", errors="ignore") as f:
            for line in f:
                if _CANCEL_EVENT.is_set():
                    raise CancelledError()
                if start_marker in line:
                    if buf is not None:
                        yield "".join(buf)
                    buf = [line]
                else:
                    if buf is not None:
                        buf.append(line)
    except CancelledError:
        raise
    except Exception:
        return

    if buf is not None:
        yield "".join(buf)


def parse_html_message_block(block_html: str) -> Optional[Dict[str, Any]]:
    p = TgHtmlMsgParser()
    try:
        p.feed(block_html)
        p.close()
    except Exception:
        return None

    from_name = re.sub(r"\s+", " ", p.from_name).strip()
    text = p.text.strip()
    if p.is_service and not text:
        text = re.sub(r"\s+", " ", p.body_details_text).strip()

    date_ts = p.date_ts if p.date_ts is not None else parse_html_title_datetime_to_unix_seconds(p.date_title)

    if date_ts <= 0:
        return None

    from_id: Optional[str]
    if p.is_out:
        from_id = "__self__"
    else:
        from_id = f"name:{from_name}" if from_name else None

    return {
        "msg_id": p.msg_id,
        "date_ts": int(date_ts),
        "from_id": from_id,
        "from_name": from_name,
        "is_out": int(p.is_out),
        "text": text,
        "media_type": p.media_type,
        "is_edited": int(p.is_edited),
        "is_service": int(p.is_service),
        "reply_to_msg_id": p.reply_to_msg_id,
    }


def build_candidates(
    export_dir: str, json_files: List[str], result_json_files: List[str], html_files: List[str]
) -> Tuple[List[ChatCandidate], int]:
    candidates: List[ChatCandidate] = []
    skipped = 0

    json_groups: Dict[str, ChatCandidate] = {}

    for path in json_files:
        if _CANCEL_EVENT.is_set():
            raise CancelledError()

        data = load_json_safely(path)
        if not is_chat_export_json(data):
            continue

        assert isinstance(data, dict)
        name_val = data.get("name")
        type_val = data.get("type")
        msgs_val = data.get("messages")

        name = name_val if isinstance(name_val, str) else (str(name_val) if name_val is not None else "")
        ctype = type_val if isinstance(type_val, str) else (str(type_val) if type_val is not None else "")
        if not isinstance(msgs_val, list):
            continue

        if ctype != "personal_chat":
            skipped += 1
            continue

        export_chat_id = derive_export_chat_id(data, path, export_dir)
        msg_count = len(msgs_val)

        if export_chat_id not in json_groups:
            json_groups[export_chat_id] = ChatCandidate(
                source="json",
                priority=3,
                export_chat_id=f"json:{export_chat_id}",
                name=name,
                type=ctype,
                approx_msgs=0,
            )

        grp = json_groups[export_chat_id]
        if not grp.name and name:
            grp.name = name
        grp.json_files.append(path)
        grp.json_file_msg_counts[path] = msg_count
        grp.approx_msgs += msg_count

    for grp in json_groups.values():
        grp.json_files.sort()
        if grp.approx_msgs <= 0:
            skipped += 1
            continue
        candidates.append(grp)

    if result_json_files:
        result_json_files_sorted = sorted(result_json_files, key=lambda p: (len(p), p))
        result_path = result_json_files_sorted[0]

        data = load_json_safely(result_path)
        if isinstance(data, dict):
            chats = data.get("chats")
            chats_list = None
            if isinstance(chats, dict):
                cl = chats.get("list")
                if isinstance(cl, list):
                    chats_list = cl

            if chats_list is not None:
                for idx, chat_obj in enumerate(chats_list):
                    if _CANCEL_EVENT.is_set():
                        raise CancelledError()
                    if not is_chat_export_json(chat_obj):
                        continue
                    assert isinstance(chat_obj, dict)

                    name_val = chat_obj.get("name")
                    type_val = chat_obj.get("type")
                    msgs_val = chat_obj.get("messages")

                    name = name_val if isinstance(name_val, str) else (str(name_val) if name_val is not None else "")
                    ctype = type_val if isinstance(type_val, str) else (str(type_val) if type_val is not None else "")
                    if not isinstance(msgs_val, list):
                        continue

                    if ctype != "personal_chat":
                        skipped += 1
                        continue

                    cid = chat_obj.get("id")
                    export_id = str(cid) if cid is not None else f"idx{idx}"
                    msg_count = len(msgs_val)

                    if msg_count <= 0:
                        skipped += 1
                        continue

                    candidates.append(
                        ChatCandidate(
                            source="result",
                            priority=2,
                            export_chat_id=f"result:{export_id}",
                            name=name,
                            type=ctype,
                            approx_msgs=msg_count,
                            result_origin_file=result_path,
                            result_chat_obj=chat_obj,
                        )
                    )

    html_by_dir: Dict[str, List[str]] = {}
    for pth in html_files:
        if _CANCEL_EVENT.is_set():
            raise CancelledError()
        d = os.path.dirname(pth)
        html_by_dir.setdefault(d, []).append(pth)

    for chat_dir, files in html_by_dir.items():
        if _CANCEL_EVENT.is_set():
            raise CancelledError()
        files.sort()
        title = extract_html_chat_title(files[0]) if files else ""
        if not title:
            title = os.path.basename(chat_dir) or "HTML chat"

        file_counts: Dict[str, int] = {}
        total = 0
        for fp in files:
            c = count_html_messages(fp)
            file_counts[fp] = c
            total += c

        if total <= 0:
            skipped += 1
            continue

        try:
            rel_dir = os.path.relpath(chat_dir, export_dir)
        except Exception:
            rel_dir = chat_dir

        candidates.append(
            ChatCandidate(
                source="html",
                priority=1,
                export_chat_id=f"html:{rel_dir}",
                name=title,
                type="unknown_html",
                approx_msgs=total,
                html_files=files,
                html_file_msg_counts=file_counts,
            )
        )

    return candidates, skipped


def dedupe_candidates(candidates: List[ChatCandidate]) -> Tuple[List[ChatCandidate], int]:
    candidates_sorted = sorted(candidates, key=lambda c: (-c.priority, normalize_name(c.name), c.export_chat_id))
    accepted: List[ChatCandidate] = []
    accepted_by_key: Dict[Tuple[str, str], List[ChatCandidate]] = {}
    skipped_dupes = 0

    for cand in candidates_sorted:
        if _CANCEL_EVENT.is_set():
            raise CancelledError()

        nname = normalize_name(cand.name)
        canonical_type = "personal_chat" if cand.type == "unknown_html" else cand.type
        key = (nname, canonical_type)

        dup_found: Optional[ChatCandidate] = None
        for ex in accepted_by_key.get(key, []):
            if counts_similar(cand.approx_msgs, ex.approx_msgs):
                dup_found = ex
                break

        if dup_found is None:
            accepted.append(cand)
            accepted_by_key.setdefault(key, []).append(cand)
            continue

        keep = dup_found
        drop = cand

        if cand.priority > dup_found.priority:
            keep = cand
            drop = dup_found
        elif cand.priority == dup_found.priority:
            if cand.approx_msgs > dup_found.approx_msgs:
                keep = cand
                drop = dup_found

        if keep is dup_found:
            skipped_dupes += 1
            continue

        skipped_dupes += 1
        try:
            accepted.remove(drop)
        except ValueError:
            pass
        lst = accepted_by_key.get(key, [])
        if drop in lst:
            lst.remove(drop)
        accepted.append(keep)
        accepted_by_key.setdefault(key, []).append(keep)

    return accepted, skipped_dupes


def calc_percent_units(unit_index: int, total_units: int, unit_fraction: float, start: int = 5, end: int = 90) -> int:
    if total_units <= 0:
        return start
    f = max(0.0, min(1.0, float(unit_fraction)))
    overall = (float(unit_index) + f) / float(total_units)
    return int(start + overall * float(end - start))


INSERT_SQL = """
  INSERT INTO messages (
    chat_pk, msg_id, date_ts, from_id, from_name, text,
    media_type, sticker_emoji, is_edited, is_service, reply_to_msg_id
  )
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);
"""


def _safe_relpath(path: str, base: str) -> str:
    try:
        return os.path.relpath(path, base)
    except Exception:
        return path


def insert_json_messages_from_file(
    conn: sqlite3.Connection,
    chat_pk: int,
    chat_name: str,
    export_dir: str,
    file_path: str,
    unit_index: int,
    total_units: int,
    est_msgs: int,
) -> int:
    if _CANCEL_EVENT.is_set():
        raise CancelledError()

    rel_file = _safe_relpath(file_path, export_dir)
    progress("parse_chat", calc_percent_units(unit_index, total_units, 0.0), chat_name, rel_file)

    data = load_json_safely(file_path)
    if not is_chat_export_json(data):
        return 0
    assert isinstance(data, dict)

    ctype = data.get("type")
    if not isinstance(ctype, str) or ctype != "personal_chat":
        return 0

    msgs_val = data.get("messages")
    if not isinstance(msgs_val, list) or not msgs_val:
        return 0

    total_msgs = len(msgs_val)

    batch_size = 2000
    inserted = 0
    batch: List[Tuple[Any, ...]] = []

    conn.execute("BEGIN;")
    try:
        for j, msg in enumerate(msgs_val):
            if _CANCEL_EVENT.is_set():
                raise CancelledError()
            if not isinstance(msg, dict):
                continue

            msg_id_value = msg.get("id")
            msg_id = str(msg_id_value) if msg_id_value is not None else None

            date_ts = parse_date_to_unix_seconds(msg.get("date"))
            if date_ts == 0:
                du = msg.get("date_unixtime")
                if isinstance(du, int):
                    date_ts = int(du)
                elif isinstance(du, str) and du.isdigit():
                    try:
                        date_ts = int(du)
                    except Exception:
                        date_ts = 0

            from_id = normalize_from_id(msg.get("from_id"))
            _ = extract_numeric_id(from_id)

            from_name_value = msg.get("from")
            if from_name_value is None:
                from_name_value = msg.get("from_name")
            from_name = from_name_value if isinstance(from_name_value, str) else (
                str(from_name_value) if from_name_value is not None else ""
            )

            text = flatten_text(msg.get("text"))

            media_type_value = msg.get("media_type")
            media_type: Optional[str] = media_type_value if isinstance(media_type_value, str) else None
            if media_type is None:
                if msg.get("photo") is not None:
                    media_type = "photo"
                elif msg.get("sticker_emoji") is not None:
                    media_type = "sticker"
                elif msg.get("file") is not None:
                    mime = msg.get("mime_type")
                    if isinstance(mime, str) and mime.startswith("video/"):
                        media_type = "video"
                    elif isinstance(mime, str) and mime.startswith("audio/"):
                        media_type = "voice"
                    else:
                        media_type = "file"

            sticker_emoji_value = msg.get("sticker_emoji")
            sticker_emoji: Optional[str] = (
                sticker_emoji_value if isinstance(sticker_emoji_value, str) else None
            )

            is_edited = 1 if msg.get("edited") else 0
            is_service = 1 if msg.get("type") == "service" else 0

            reply_to = msg.get("reply_to_message_id")
            if reply_to is None:
                reply_to = msg.get("reply_to_msg_id")
            reply_to_msg_id = str(reply_to) if reply_to is not None else None

            batch.append(
                (
                    chat_pk,
                    msg_id,
                    int(date_ts),
                    from_id,
                    from_name,
                    text,
                    media_type,
                    sticker_emoji,
                    int(is_edited),
                    int(is_service),
                    reply_to_msg_id,
                )
            )

            if len(batch) >= batch_size:
                conn.executemany(INSERT_SQL, batch)
                inserted += len(batch)
                batch.clear()

            if (j + 1) % 500 == 0:
                frac = float(j + 1) / float(total_msgs) if total_msgs > 0 else 1.0
                progress("insert_db", calc_percent_units(unit_index, total_units, frac), chat_name, rel_file)

        if batch:
            conn.executemany(INSERT_SQL, batch)
            inserted += len(batch)
            batch.clear()

        conn.execute("COMMIT;")
    except CancelledError:
        try:
            conn.execute("ROLLBACK;")
        except Exception:
            pass
        raise
    except Exception:
        try:
            conn.execute("ROLLBACK;")
        except Exception:
            pass
        write_json({"type": "warning", "message": f"Failed to insert JSON file: {rel_file}"})
        return inserted

    progress("insert_db", calc_percent_units(unit_index, total_units, 1.0), chat_name, rel_file)
    return inserted


def insert_result_chat_messages(
    conn: sqlite3.Connection,
    chat_pk: int,
    chat_name: str,
    export_dir: str,
    origin_file: str,
    chat_obj: Dict[str, Any],
    unit_index: int,
    total_units: int,
    est_msgs: int,
) -> int:
    if _CANCEL_EVENT.is_set():
        raise CancelledError()

    rel_file = _safe_relpath(origin_file, export_dir)
    progress("parse_chat", calc_percent_units(unit_index, total_units, 0.0), chat_name, rel_file)

    msgs_val = chat_obj.get("messages")
    if not isinstance(msgs_val, list) or not msgs_val:
        return 0

    total_msgs = len(msgs_val)

    batch_size = 2000
    inserted = 0
    batch: List[Tuple[Any, ...]] = []

    conn.execute("BEGIN;")
    try:
        for j, msg in enumerate(msgs_val):
            if _CANCEL_EVENT.is_set():
                raise CancelledError()
            if not isinstance(msg, dict):
                continue

            msg_id_value = msg.get("id")
            msg_id = str(msg_id_value) if msg_id_value is not None else None

            date_ts = parse_date_to_unix_seconds(msg.get("date"))
            if date_ts == 0:
                du = msg.get("date_unixtime")
                if isinstance(du, int):
                    date_ts = int(du)
                elif isinstance(du, str) and du.isdigit():
                    try:
                        date_ts = int(du)
                    except Exception:
                        date_ts = 0

            from_id = normalize_from_id(msg.get("from_id"))
            _ = extract_numeric_id(from_id)

            from_name_value = msg.get("from")
            if from_name_value is None:
                from_name_value = msg.get("from_name")
            from_name = from_name_value if isinstance(from_name_value, str) else (
                str(from_name_value) if from_name_value is not None else ""
            )

            text = flatten_text(msg.get("text"))

            media_type_value = msg.get("media_type")
            media_type: Optional[str] = media_type_value if isinstance(media_type_value, str) else None
            if media_type is None:
                if msg.get("photo") is not None:
                    media_type = "photo"
                elif msg.get("sticker_emoji") is not None:
                    media_type = "sticker"
                elif msg.get("file") is not None:
                    mime = msg.get("mime_type")
                    if isinstance(mime, str) and mime.startswith("video/"):
                        media_type = "video"
                    elif isinstance(mime, str) and mime.startswith("audio/"):
                        media_type = "voice"
                    else:
                        media_type = "file"

            sticker_emoji_value = msg.get("sticker_emoji")
            sticker_emoji: Optional[str] = (
                sticker_emoji_value if isinstance(sticker_emoji_value, str) else None
            )

            is_edited = 1 if msg.get("edited") else 0
            is_service = 1 if msg.get("type") == "service" else 0

            reply_to = msg.get("reply_to_message_id")
            if reply_to is None:
                reply_to = msg.get("reply_to_msg_id")
            reply_to_msg_id = str(reply_to) if reply_to is not None else None

            batch.append(
                (
                    chat_pk,
                    msg_id,
                    int(date_ts),
                    from_id,
                    from_name,
                    text,
                    media_type,
                    sticker_emoji,
                    int(is_edited),
                    int(is_service),
                    reply_to_msg_id,
                )
            )

            if len(batch) >= batch_size:
                conn.executemany(INSERT_SQL, batch)
                inserted += len(batch)
                batch.clear()

            if (j + 1) % 500 == 0:
                frac = float(j + 1) / float(total_msgs) if total_msgs > 0 else 1.0
                progress("insert_db", calc_percent_units(unit_index, total_units, frac), chat_name, rel_file)

        if batch:
            conn.executemany(INSERT_SQL, batch)
            inserted += len(batch)
            batch.clear()

        conn.execute("COMMIT;")
    except CancelledError:
        try:
            conn.execute("ROLLBACK;")
        except Exception:
            pass
        raise
    except Exception:
        try:
            conn.execute("ROLLBACK;")
        except Exception:
            pass
        write_json({"type": "warning", "message": f"Failed to insert result.json chat: {chat_name}"})
        return inserted

    progress("insert_db", calc_percent_units(unit_index, total_units, 1.0), chat_name, rel_file)
    return inserted


def insert_html_messages_from_file(
    conn: sqlite3.Connection,
    chat_pk: int,
    chat_name: str,
    export_dir: str,
    file_path: str,
    unit_index: int,
    total_units: int,
    est_msgs: int,
) -> int:
    if _CANCEL_EVENT.is_set():
        raise CancelledError()

    rel_file = _safe_relpath(file_path, export_dir)
    progress("parse_chat", calc_percent_units(unit_index, total_units, 0.0), chat_name, rel_file)

    batch_size = 2000
    inserted = 0
    batch: List[Tuple[Any, ...]] = []

    seen = 0
    total_est = est_msgs if est_msgs > 0 else 1

    conn.execute("BEGIN;")
    try:
        for block in iter_html_message_blocks(file_path):
            if _CANCEL_EVENT.is_set():
                raise CancelledError()

            seen += 1
            msg = parse_html_message_block(block)
            if msg is None:
                continue

            msg_id = msg.get("msg_id")
            date_ts = msg.get("date_ts", 0)
            from_name = msg.get("from_name", "")
            text = msg.get("text", "")
            media_type = msg.get("media_type")
            is_edited = msg.get("is_edited", 0)
            is_service = msg.get("is_service", 0)
            reply_to_msg_id = msg.get("reply_to_msg_id")
            from_id_val = msg.get("from_id")
            from_id: Optional[str] = (
                from_id_val.strip() if isinstance(from_id_val, str) and from_id_val.strip() else None
            )
            sticker_emoji: Optional[str] = None

            batch.append(
                (
                    chat_pk,
                    msg_id,
                    int(date_ts),
                    from_id,
                    from_name,
                    text,
                    media_type,
                    sticker_emoji,
                    int(is_edited),
                    int(is_service),
                    reply_to_msg_id,
                )
            )

            if len(batch) >= batch_size:
                conn.executemany(INSERT_SQL, batch)
                inserted += len(batch)
                batch.clear()

            if seen % 300 == 0:
                frac = min(1.0, float(seen) / float(total_est))
                progress("insert_db", calc_percent_units(unit_index, total_units, frac), chat_name, rel_file)

        if batch:
            conn.executemany(INSERT_SQL, batch)
            inserted += len(batch)
            batch.clear()

        conn.execute("COMMIT;")
    except CancelledError:
        try:
            conn.execute("ROLLBACK;")
        except Exception:
            pass
        raise
    except Exception:
        try:
            conn.execute("ROLLBACK;")
        except Exception:
            pass
        write_json({"type": "warning", "message": f"Failed to parse/insert HTML file: {rel_file}"})
        return inserted

    progress("insert_db", calc_percent_units(unit_index, total_units, 1.0), chat_name, rel_file)
    return inserted


def do_import(export_dir: str, mode: str, db_path: str) -> None:
    _ = mode

    progress("scan_files", 0, "", "")

    json_files, result_files, html_files = scan_export_dir(export_dir)

    progress("scan_files", 3, "", "")
    candidates, skipped_chats = build_candidates(export_dir, json_files, result_files, html_files)
    progress("scan_files", 5, "", "")

    if not candidates:
        raise RuntimeError("Не найдено данных для импорта: нет chat JSON, result.json chats.list, или messages*.html.")

    accepted, skipped_dupes = dedupe_candidates(candidates)

    if not accepted:
        raise RuntimeError("После фильтрации и дедупликации не осталось чатов для импорта.")

    skipped_total = int(skipped_chats + skipped_dupes)

    json_chats = sum(1 for c in accepted if c.source in ("json", "result"))
    html_chats = sum(1 for c in accepted if c.source == "html")
    unknown_html_chats = sum(1 for c in accepted if c.type == "unknown_html")

    conn: Optional[sqlite3.Connection] = None
    inserted_messages = 0

    try:
        if _CANCEL_EVENT.is_set():
            raise CancelledError()

        conn = recreate_db(db_path)

        for c in accepted:
            if _CANCEL_EVENT.is_set():
                raise CancelledError()
            cur = conn.execute(
                "INSERT INTO chats(export_chat_id, name, type) VALUES (?, ?, ?);",
                (c.export_chat_id, c.name, c.type),
            )
            c.chat_pk = int(cur.lastrowid)

        try:
            conn.commit()
        except Exception:
            pass

        units: List[Unit] = []
        accepted_sorted = sorted(accepted, key=lambda c: (-c.priority, normalize_name(c.name), c.export_chat_id))
        for c in accepted_sorted:
            if c.source == "json":
                for fp in c.json_files:
                    units.append(Unit(kind="json_file", file_path=fp, chat=c, est_msgs=c.json_file_msg_counts.get(fp, 0)))
            elif c.source == "result":
                origin = c.result_origin_file or "result.json"
                units.append(Unit(kind="result_chat", file_path=origin, chat=c, est_msgs=c.approx_msgs))
            elif c.source == "html":
                for fp in c.html_files:
                    units.append(Unit(kind="html_file", file_path=fp, chat=c, est_msgs=c.html_file_msg_counts.get(fp, 0)))

        total_units = len(units)
        if total_units <= 0:
            raise RuntimeError("No processing units after scan.")

        for ui, unit in enumerate(units):
            if _CANCEL_EVENT.is_set():
                raise CancelledError()
            if unit.chat.chat_pk is None:
                continue
            chat_pk = int(unit.chat.chat_pk)
            chat_name = unit.chat.name

            if unit.kind == "json_file":
                inserted_messages += insert_json_messages_from_file(
                    conn=conn,
                    chat_pk=chat_pk,
                    chat_name=chat_name,
                    export_dir=export_dir,
                    file_path=unit.file_path,
                    unit_index=ui,
                    total_units=total_units,
                    est_msgs=unit.est_msgs,
                )
            elif unit.kind == "result_chat":
                if unit.chat.result_chat_obj is None:
                    continue
                inserted_messages += insert_result_chat_messages(
                    conn=conn,
                    chat_pk=chat_pk,
                    chat_name=chat_name,
                    export_dir=export_dir,
                    origin_file=unit.file_path,
                    chat_obj=unit.chat.result_chat_obj,
                    unit_index=ui,
                    total_units=total_units,
                    est_msgs=unit.est_msgs,
                )
            elif unit.kind == "html_file":
                inserted_messages += insert_html_messages_from_file(
                    conn=conn,
                    chat_pk=chat_pk,
                    chat_name=chat_name,
                    export_dir=export_dir,
                    file_path=unit.file_path,
                    unit_index=ui,
                    total_units=total_units,
                    est_msgs=unit.est_msgs,
                )

        if _CANCEL_EVENT.is_set():
            raise CancelledError()

        progress("index_db", 90, "", "")
        try:
            ensure_schema(conn)
            self_from_id = compute_self_from_id(conn)
            apply_direction_updates(conn, self_from_id)
        except CancelledError:
            raise
        except Exception as e:
            write_json({"type": "warning", "message": f"Failed to compute direction: {str(e)}"})

        progress("index_db", 92, "", "")
        create_indexes(conn)

        try:
            conn.execute("PRAGMA wal_checkpoint(TRUNCATE);")
        except Exception:
            pass

        conn.close()
        conn = None

        db_size = compute_db_total_size_bytes(db_path)

        progress("done", 100, "", "")
        write_json(
            {
                "type": "import_done",
                "chats": len(accepted),
                "messages": int(inserted_messages),
                "db_path": db_path,
                "db_size_bytes": int(db_size),
                "json_chats": int(json_chats),
                "html_chats": int(html_chats),
                "skipped_chats": int(skipped_total),
                "unknown_html_chats": int(unknown_html_chats),
            }
        )

    except CancelledError:
        if conn is not None:
            try:
                conn.execute("ROLLBACK;")
            except Exception:
                pass
            try:
                conn.close()
            except Exception:
                pass
            conn = None

        ensure_removed(db_path)
        ensure_removed(db_path + "-wal")
        ensure_removed(db_path + "-shm")

        write_json({"type": "error", "message": "Import cancelled"})
        return

    finally:
        if conn is not None:
            try:
                conn.close()
            except Exception:
                pass


def start_import_thread(export_dir: str, mode: str, db_path: str) -> None:
    global _IMPORT_THREAD

    def _runner() -> None:
        try:
            do_import(export_dir, mode, db_path)
        except Exception as e:
            write_json({"type": "error", "message": str(e)})

    with _IMPORT_LOCK:
        if _REPORT_THREAD is not None and _REPORT_THREAD.is_alive():
            write_json({"type": "error", "message": "Report generation already running"})
            return
        if _IMPORT_THREAD is not None and _IMPORT_THREAD.is_alive():
            write_json({"type": "error", "message": "Import already running"})
            return

        _CANCEL_EVENT.clear()
        t = threading.Thread(target=_runner, name="tgwr_import", daemon=True)
        _IMPORT_THREAD = t
        t.start()


_STOPWORDS_RU_EN = set(
    """
и в во не что он на я с со как а то все она так его но да ты к у же вы за бы по только ее мне было вот от меня еще нет о из ему теперь когда даже ну вдруг ли если уже или ни быть был была было были буду будешь будет будем будете будут будут будут бывая бывал бывала бывали
него до вас нибудь опять уж вам ведь там потом себя ничего ей может они тут где есть надо ней для мы тебя их чем
сам сама сами само самих самими самому самого самой самом самому
чтоб без будто чего раз тоже себе под будет ж тогда кто этот того потому этого какой совсем ним здесь этом один почти мой тем чтобы нее сейчас
куда зачем всех никогда можно при наконец два об другой хоть после над больше тот через эти нас про всего них какая много разве три эту моя впрочем хорошо свою этой перед иногда лучше чуть том нельзя такой им более всегда конечно всю между

это эта эти этот этому этим этой этого этого-то такое такой такая такие такие-то
тот та те то тому тем того т.е теми тех туда сюда отсюда оттуда здесь там тут
когда пока почему зачем где куда откуда
который которая которое которые которых которому которым которую которыми
весь вся все всем всему всех всеми всего всей
свой своя свое свои своих своим своими своему своего своей
себя себе собой собою

я ты он она оно мы вы они меня мне мною мной тебя тебе тобой тобою его ему им ею ей ее еею ею их ими ими
наш наша наше наши вашего ваша ваши твой твоя твое твои мой моя мое мои

или либо да нет ага угу ок okay ok дада
ну вот короче типа типо просто вообще реально кстати ладно
пж плиз плз pls plz
спс спасибо пожалуйста
привет здравствуйте здрасьте пока
добрый утро день вечер ночь
ха хаха ахах аха лол кек омг wtf
мм ммм эм эээ ээээ
ща щас сейчас сегодня завтра вчера

the a an and or but if then else to of in on at for from with without is are was were be been being it this that these those
i you he she we they me my mine your yours his her hers their theirs our ours us them
as not no yes do does did done have has had will would can could should may might must also just so very
than too into about over under up down out off again further here there when where why how
all any both each few more most other some such only own same
""".split()
)


_URL_RE = re.compile(
    r"(?i)\b(?:https?://\S+|www\.[^\s]+|t\.me/\S+|telegram\.me/\S+|tg://\S+|\w[\w\-]*\.(?:ru|com|net|org|io|me|app|dev|gg|co|info|biz|рф)(?:/\S*)?)"
)

_WORD_RE = re.compile(r"[A-Za-zА-Яа-яЁё]{2,}", flags=re.UNICODE)

_EMOJI_RE = re.compile(
    "["
    "\U0001F1E0-\U0001F1FF"
    "\U0001F300-\U0001F5FF"
    "\U0001F600-\U0001F64F"
    "\U0001F680-\U0001F6FF"
    "\U0001F700-\U0001F77F"
    "\U0001F780-\U0001F7FF"
    "\U0001F800-\U0001F8FF"
    "\U0001F900-\U0001F9FF"
    "\U0001FA00-\U0001FAFF"
    "\u2600-\u26FF"
    "\u2700-\u27BF"
    "]"
)


def _strip_urls(text: str) -> str:
    if not text:
        return ""
    return _URL_RE.sub(" ", text)


def clean_text_for_stats(text: str) -> str:
    s = _strip_urls(text)
    s = s.replace("\u00a0", " ")
    s = re.sub(r"\s+", " ", s).strip()
    return s


def tokenize_words(text: str) -> List[str]:
    s = clean_text_for_stats(text).lower()
    s = s.replace("ё", "е")
    out: List[str] = []
    for w in _WORD_RE.findall(s):
        ww = w.lower().replace("ё", "е")
        if ww in _STOPWORDS_RU_EN:
            continue
        out.append(ww)
    return out


def extract_emojis(text: str) -> List[str]:
    if not text:
        return []
    s = _strip_urls(text)
    return _EMOJI_RE.findall(s)


def _median_int(values: List[int]) -> int:
    if not values:
        return 0
    try:
        return int(statistics.median(values))
    except Exception:
        values_sorted = sorted(values)
        mid = len(values_sorted) // 2
        if len(values_sorted) % 2 == 1:
            return int(values_sorted[mid])
        return int((values_sorted[mid - 1] + values_sorted[mid]) / 2)


def _safe_div(n: float, d: float) -> float:
    if d == 0:
        return 0.0
    return float(n) / float(d)


def _normalize_media_bucket(media_type: Optional[str]) -> Optional[str]:
    if not media_type:
        return None
    s = media_type.strip().lower()
    if not s:
        return None
    if "photo" in s or s == "image":
        return "photo"
    if "video" in s:
        return "video"
    if "voice" in s or "audio" in s:
        return "voice"
    if "sticker" in s:
        return "sticker"
    if "gif" in s:
        return "gif"
    if "file" in s or "document" in s:
        return "file"
    return "other"


def _period_where_clause(start_ts: int, end_ts: int) -> Tuple[str, Tuple[Any, ...]]:
    return "date_ts >= ? AND date_ts < ?", (int(start_ts), int(end_ts))


def _count_messages(conn: sqlite3.Connection, start_ts: int, end_ts: int, where_extra: str = "", params_extra: Tuple[Any, ...] = ()) -> int:
    base, p = _period_where_clause(start_ts, end_ts)
    sql = f"SELECT COUNT(*) FROM messages WHERE {base} {where_extra};"
    row = conn.execute(sql, p + params_extra).fetchone()
    return int(row[0]) if row and row[0] is not None else 0


def _most_active_group(conn: sqlite3.Connection, start_ts: int, end_ts: int, group_expr: str, label: str) -> Dict[str, Any]:
    base, p = _period_where_clause(start_ts, end_ts)
    sql = (
        f"SELECT {group_expr} AS k, COUNT(*) AS cnt "
        f"FROM messages WHERE is_service = 0 AND {base} "
        f"GROUP BY k ORDER BY cnt DESC LIMIT 1;"
    )
    row = conn.execute(sql, p).fetchone()
    if not row:
        return {"value": None, "count": 0}
    return {"value": row[0], "count": int(row[1] or 0)}


def _distinct_days_count(conn: sqlite3.Connection, start_ts: int, end_ts: int) -> int:
    base, p = _period_where_clause(start_ts, end_ts)
    row = conn.execute(
        f"SELECT COUNT(DISTINCT date((date_ts + {MSK_OFFSET_SECONDS}), 'unixepoch')) "
        f"FROM messages WHERE is_service = 0 AND {base};",
        p,
    ).fetchone()
    return int(row[0] or 0) if row else 0


def _people_stats(conn: sqlite3.Connection, start_ts: int, end_ts: int) -> Dict[str, Dict[str, Any]]:
    base, p = _period_where_clause(start_ts, end_ts)
    sql = (
        "SELECT c.peer_from_id AS peer_from_id, "
        "       MAX(c.name) AS display_name, "
        "       COUNT(*) AS total_messages, "
        "       SUM(CASE WHEN m.is_out = 1 THEN 1 ELSE 0 END) AS sent_messages, "
        "       SUM(CASE WHEN m.is_out = 0 THEN 1 ELSE 0 END) AS received_messages, "
        "       MIN(m.date_ts) AS first_ts, "
        "       MAX(m.date_ts) AS last_ts, "
        f"       COUNT(DISTINCT date((m.date_ts + {MSK_OFFSET_SECONDS}), 'unixepoch')) AS active_days, "
        f"       SUM(CASE WHEN CAST(strftime('%H', (m.date_ts + {MSK_OFFSET_SECONDS}), 'unixepoch') AS INTEGER) BETWEEN 0 AND 5 THEN 1 ELSE 0 END) AS night_messages, "
        f"       SUM(CASE WHEN CAST(strftime('%H', (m.date_ts + {MSK_OFFSET_SECONDS}), 'unixepoch') AS INTEGER) BETWEEN 6 AND 17 THEN 1 ELSE 0 END) AS day_messages "
        "FROM messages m JOIN chats c ON m.chat_pk = c.chat_pk "
        f"WHERE m.is_service = 0 AND c.peer_from_id IS NOT NULL AND {base} "
        "GROUP BY c.peer_from_id;"
    )
    out: Dict[str, Dict[str, Any]] = {}
    for row in conn.execute(sql, p):
        peer = row[0]
        if not isinstance(peer, str) or not peer.strip():
            continue
        display_name = row[1] if isinstance(row[1], str) else ""
        total = int(row[2] or 0)
        sent = int(row[3] or 0)
        recv = int(row[4] or 0)
        first_ts = int(row[5] or 0)
        last_ts = int(row[6] or 0)
        active_days = int(row[7] or 0)
        night_msgs = int(row[8] or 0)
        day_msgs = int(row[9] or 0)
        out[peer] = {
            "peer_from_id": peer,
            "display_name": display_name,
            "total_messages": total,
            "sent_messages": sent,
            "received_messages": recv,
            "first_ts": first_ts,
            "last_ts": last_ts,
            "time_span_seconds": max(0, last_ts - first_ts) if first_ts and last_ts else 0,
            "active_days": active_days,
            "night_messages": night_msgs,
            "day_messages": day_msgs,
            "mutuality_abs_diff": abs(sent - recv),
        }
    return out


def _compute_reply_times(conn: sqlite3.Connection, year_start_ts: int, year_end_ts: int) -> Dict[str, Any]:
    q = (
        "SELECT m.chat_pk, m.date_ts, m.is_out, c.peer_from_id "
        "FROM messages m JOIN chats c ON m.chat_pk = c.chat_pk "
        "WHERE m.is_service = 0 AND c.peer_from_id IS NOT NULL "
        "ORDER BY m.chat_pk, m.date_ts;"
    )
    global_all: List[int] = []
    global_year: List[int] = []
    per_peer_all: Dict[str, List[int]] = defaultdict(list)
    per_peer_year: Dict[str, List[int]] = defaultdict(list)

    last_chat_pk: Optional[int] = None
    last_in_all: Optional[int] = None
    last_in_year: Optional[int] = None
    last_peer: Optional[str] = None

    for row in conn.execute(q):
        if _CANCEL_EVENT.is_set():
            raise CancelledError()

        chat_pk = int(row[0])
        ts = int(row[1] or 0)
        is_out = int(row[2] or 0)
        peer = row[3]
        peer_id = peer if isinstance(peer, str) else None

        if last_chat_pk is None or chat_pk != last_chat_pk:
            last_chat_pk = chat_pk
            last_in_all = None
            last_in_year = None
            last_peer = peer_id
        else:
            last_peer = peer_id

        if ts <= 0 or not peer_id:
            continue

        if is_out == 0:
            last_in_all = ts
            if year_start_ts <= ts < year_end_ts:
                last_in_year = ts
            else:
                last_in_year = None
            continue

        if last_in_all is not None and ts > last_in_all:
            d = ts - last_in_all
            global_all.append(d)
            per_peer_all[peer_id].append(d)
            last_in_all = None

        if year_start_ts <= ts < year_end_ts and last_in_year is not None and ts > last_in_year:
            d2 = ts - last_in_year
            global_year.append(d2)
            per_peer_year[peer_id].append(d2)
            last_in_year = None

    per_peer_all_med: Dict[str, int] = {k: _median_int(v) for k, v in per_peer_all.items() if v}
    per_peer_year_med: Dict[str, int] = {k: _median_int(v) for k, v in per_peer_year.items() if v}

    return {
        "global_median_all_time_seconds": _median_int(global_all),
        "global_median_year_seconds": _median_int(global_year),
        "per_peer_median_all_time_seconds": per_peer_all_med,
        "per_peer_median_year_seconds": per_peer_year_med,
        "per_peer_samples_all_time": {k: len(v) for k, v in per_peer_all.items()},
        "per_peer_samples_year": {k: len(v) for k, v in per_peer_year.items()},
        "global_samples_all_time": len(global_all),
        "global_samples_year": len(global_year),
    }


def _longest_silence_gap(conn: sqlite3.Connection, start_ts: int, end_ts: int) -> Dict[str, Any]:
    base, p = _period_where_clause(start_ts, end_ts)
    q = f"SELECT chat_pk, date_ts FROM messages WHERE is_service = 0 AND {base} ORDER BY chat_pk, date_ts;"
    max_gap = 0
    max_chat_pk: Optional[int] = None
    max_prev_ts: Optional[int] = None
    max_cur_ts: Optional[int] = None

    last_chat: Optional[int] = None
    prev_ts: Optional[int] = None

    for row in conn.execute(q, p):
        if _CANCEL_EVENT.is_set():
            raise CancelledError()
        chat_pk = int(row[0])
        ts = int(row[1] or 0)
        if ts <= 0:
            continue
        if last_chat is None or chat_pk != last_chat:
            last_chat = chat_pk
            prev_ts = ts
            continue
        if prev_ts is not None and ts > prev_ts:
            gap = ts - prev_ts
            if gap > max_gap:
                max_gap = gap
                max_chat_pk = chat_pk
                max_prev_ts = prev_ts
                max_cur_ts = ts
        prev_ts = ts

    chat_name = None
    peer_id = None
    if max_chat_pk is not None:
        try:
            r = conn.execute("SELECT name, peer_from_id FROM chats WHERE chat_pk = ?;", (max_chat_pk,)).fetchone()
            if r:
                chat_name = r[0] if isinstance(r[0], str) else None
                peer_id = r[1] if isinstance(r[1], str) else None
        except Exception:
            pass

    return {
        "gap_seconds": int(max_gap),
        "chat_pk": max_chat_pk,
        "chat_name": chat_name,
        "peer_from_id": peer_id,
        "from_ts": max_prev_ts,
        "to_ts": max_cur_ts,
    }


def _longest_streak_days(conn: sqlite3.Connection, start_ts: int, end_ts: int) -> Dict[str, Any]:
    base, p = _period_where_clause(start_ts, end_ts)
    q = (
        f"SELECT DISTINCT date((date_ts + {MSK_OFFSET_SECONDS}), 'unixepoch') AS d "
        f"FROM messages WHERE is_service = 0 AND {base} ORDER BY d;"
    )
    dates: List[str] = [r[0] for r in conn.execute(q, p) if r and isinstance(r[0], str)]
    if not dates:
        return {"length_days": 0, "start_date": None, "end_date": None}

    def _parse(d: str) -> datetime:
        return datetime.strptime(d, "%Y-%m-%d")

    best_len = 1
    best_start = dates[0]
    best_end = dates[0]

    cur_len = 1
    cur_start = dates[0]
    prev = _parse(dates[0])

    for d in dates[1:]:
        cur = _parse(d)
        if (cur - prev).days == 1:
            cur_len += 1
        else:
            if cur_len > best_len:
                best_len = cur_len
                best_start = cur_start
                best_end = prev.strftime("%Y-%m-%d")
            cur_len = 1
            cur_start = d
        prev = cur

    if cur_len > best_len:
        best_len = cur_len
        best_start = cur_start
        best_end = prev.strftime("%Y-%m-%d")

    return {"length_days": int(best_len), "start_date": best_start, "end_date": best_end}


def _longest_person_streak(conn: sqlite3.Connection, start_ts: int, end_ts: int) -> Optional[Dict[str, Any]]:
    base, p = _period_where_clause(start_ts, end_ts)

    # Вытаскиваем твой ID, чтобы исключить чат с самим собой
    self_from_id = meta_get(conn, "self_from_id") or "UNKNOWN_SELF"

    # Фильтруем Избранное, ботов и самого себя
    q = (
        f"SELECT c.peer_from_id, "
        f"       MAX(c.name) AS display_name, "
        f"       date((m.date_ts + {MSK_OFFSET_SECONDS}), 'unixepoch') AS d "
        f"FROM messages m JOIN chats c ON m.chat_pk = c.chat_pk "
        f"WHERE m.is_service = 0 "
        f"  AND c.peer_from_id IS NOT NULL "
        f"  AND TRIM(c.peer_from_id) != '' "
        f"  AND c.peer_from_id != ? "
        f"  AND c.peer_from_id != 'user1098898489' " # <--- ПЕРМАБАН ЗДЕСЬ
        f"  AND (c.name IS NULL OR (c.name NOT LIKE '%Saved Messages%' AND c.name NOT LIKE '%Избранное%')) "
        f"  AND {base} "
        f"GROUP BY c.peer_from_id, d "
        f"ORDER BY c.peer_from_id, d;"
    )

    # Передаем твой ID первым параметром в запрос
    params = (self_from_id,) + p

    best_len = 0
    best_start = None
    best_end = None
    best_peer = None
    best_name = None

    current_peer = None
    current_name = None
    current_len = 0
    current_start = None
    prev_date_obj = None

    def _parse(d_str: str) -> datetime:
        return datetime.strptime(d_str, "%Y-%m-%d")

    for row in conn.execute(q, params):
        if _CANCEL_EVENT.is_set():
            raise CancelledError()

        peer_id = row[0]
        display_name = row[1] if isinstance(row[1], str) else ""
        d_str = row[2]

        if not isinstance(d_str, str):
            continue

        d_obj = _parse(d_str)

        if peer_id != current_peer:
            if current_len > best_len:
                best_len = current_len
                best_start = current_start
                best_end = prev_date_obj.strftime("%Y-%m-%d") if prev_date_obj else current_start
                best_peer = current_peer
                best_name = current_name

            current_peer = peer_id
            current_name = display_name
            current_len = 1
            current_start = d_str
            prev_date_obj = d_obj
        else:
            if prev_date_obj and (d_obj - prev_date_obj).days == 1:
                current_len += 1
            else:
                if current_len > best_len:
                    best_len = current_len
                    best_start = current_start
                    best_end = prev_date_obj.strftime("%Y-%m-%d")
                    best_peer = current_peer
                    best_name = current_name

                current_len = 1
                current_start = d_str

            prev_date_obj = d_obj

    # Последняя проверка после выхода из цикла
    if current_len > best_len:
        best_len = current_len
        best_start = current_start
        best_end = prev_date_obj.strftime("%Y-%m-%d") if prev_date_obj else current_start
        best_peer = current_peer
        best_name = current_name

    if best_len <= 0 or not best_peer:
        return None

    return {
        "length_days": int(best_len),
        "start_date": best_start,
        "end_date": best_end,
        "peer_from_id": best_peer,
        "display_name": best_name,
    }


def _text_metrics_sent(conn: sqlite3.Connection, start_ts: int, end_ts: int) -> Dict[str, Any]:
    base, p = _period_where_clause(start_ts, end_ts)
    q = (
        "SELECT m.text, m.sticker_emoji, m.msg_id, m.date_ts, c.name, c.peer_from_id "
        "FROM messages m JOIN chats c ON m.chat_pk = c.chat_pk "
        f"WHERE m.is_service = 0 AND m.is_out = 1 AND {base};"
    )

    total_len = 0
    count_len = 0

    longest_len = 0
    longest: Dict[str, Any] = {
        "length_chars": 0,
        "snippet": "",
        "peer_from_id": None,
        "display_name": None,
        "msg_id": None,
        "date_ts": None,
    }

    word_counter: Counter[str] = Counter()
    emoji_counter: Counter[str] = Counter()
    total_words = 0

    fetch = conn.execute(q, p)
    while True:
        if _CANCEL_EVENT.is_set():
            raise CancelledError()
        rows = fetch.fetchmany(2000)
        if not rows:
            break
        for row in rows:
            if _CANCEL_EVENT.is_set():
                raise CancelledError()
            text = row[0] if isinstance(row[0], str) else ""
            sticker_emoji = row[1] if isinstance(row[1], str) else None
            msg_id = row[2] if row[2] is not None else None
            date_ts = int(row[3] or 0)
            chat_name = row[4] if isinstance(row[4], str) else None
            peer_id = row[5] if isinstance(row[5], str) else None

            cleaned = clean_text_for_stats(text)
            if cleaned:
                l = len(cleaned)
                total_len += l
                count_len += 1
                if l > longest_len:
                    longest_len = l
                    longest = {
                        "length_chars": int(l),
                        "snippet": (cleaned[:220] + "…") if len(cleaned) > 220 else cleaned,
                        "peer_from_id": peer_id,
                        "display_name": chat_name,
                        "msg_id": str(msg_id) if msg_id is not None else None,
                        "date_ts": date_ts if date_ts > 0 else None,
                    }

                toks = tokenize_words(cleaned)
                if toks:
                    word_counter.update(toks)
                    total_words += len(toks)

                emojis = extract_emojis(cleaned)
                if emojis:
                    emoji_counter.update(emojis)

            if sticker_emoji:
                emoji_counter.update([sticker_emoji])

    top_words = [{"word": w, "count": int(c)} for w, c in word_counter.most_common(50)]
    word_cloud = {w: int(c) for w, c in word_counter.most_common(200)}
    top_emojis = [{"emoji": e, "count": int(c)} for e, c in emoji_counter.most_common(50)]

    avg_len = int(round(total_len / count_len)) if count_len > 0 else 0

    return {
        "average_msg_length_sent_chars": int(avg_len),
        "average_msg_length_sent_samples": int(count_len),
        "longest_message_sent": longest,
        "top_words": top_words,
        "word_cloud": word_cloud,
        "top_emojis": top_emojis,
        "total_words_sent": int(total_words),
        "unique_words_sent": int(len(word_counter)),
        "total_emojis_sent": int(sum(emoji_counter.values())),
    }


def _media_counts(conn: sqlite3.Connection, start_ts: int, end_ts: int) -> Dict[str, int]:
    base, p = _period_where_clause(start_ts, end_ts)
    q = f"SELECT media_type, COUNT(*) FROM messages WHERE is_service = 0 AND media_type IS NOT NULL AND TRIM(media_type) != '' AND {base} GROUP BY media_type;"
    buckets = {"photo": 0, "video": 0, "voice": 0, "sticker": 0, "gif": 0, "file": 0, "other": 0}
    for row in conn.execute(q, p):
        mt = row[0] if isinstance(row[0], str) else None
        cnt = int(row[1] or 0)
        b = _normalize_media_bucket(mt)
        if b is None:
            continue
        buckets[b] = int(buckets.get(b, 0) + cnt)
    return buckets


def _deleted_messages_count(conn: sqlite3.Connection, start_ts: int, end_ts: int) -> int:
    base, p = _period_where_clause(start_ts, end_ts)
    patterns = [
        "%deleted%",
        "%удал%",
        "%сообщение удал%",
        "%message was deleted%",
    ]
    cond = " OR ".join(["LOWER(text) LIKE ?" for _ in patterns])
    sql = f"SELECT COUNT(*) FROM messages WHERE is_service = 1 AND text IS NOT NULL AND ({cond}) AND {base};"
    row = conn.execute(sql, tuple(x.lower() for x in patterns) + p).fetchone()
    return int(row[0] or 0) if row else 0


def _pick_person_by_metric(people: Dict[str, Dict[str, Any]], key: str, reverse: bool = True) -> Optional[Dict[str, Any]]:
    if not people:
        return None
    lst = sorted(people.values(), key=lambda x: (int(x.get(key, 0) or 0), int(x.get("total_messages", 0) or 0)), reverse=reverse)
    return lst[0] if lst else None


def _top_10_people_by_messages(people: Dict[str, Dict[str, Any]]) -> List[Dict[str, Any]]:
    items: List[Tuple[int, Dict[str, Any]]] = []

    for it in people.values():
        total = int(it.get("total_messages", 0) or 0)
        if total <= 0:
            continue
        items.append((total, it))

    items.sort(key=lambda x: x[0], reverse=True)

    out: List[Dict[str, Any]] = []
    for total, it in items[:10]:
        out.append(
            {
                "peer_from_id": it.get("peer_from_id"),
                "display_name": it.get("display_name"),
                "total_messages": total,
                "sent_messages": int(it.get("sent_messages", 0) or 0),
                "received_messages": int(it.get("received_messages", 0) or 0),
            }
        )

    return out


def _top_10_people_by_time_span(people: Dict[str, Dict[str, Any]]) -> List[Dict[str, Any]]:
    lst = sorted(people.values(), key=lambda x: int(x.get("time_span_seconds", 0) or 0), reverse=True)
    out: List[Dict[str, Any]] = []
    for it in lst[:10]:
        out.append(
            {
                "peer_from_id": it.get("peer_from_id"),
                "display_name": it.get("display_name"),
                "time_span_seconds": int(it.get("time_span_seconds", 0) or 0),
                "first_ts": it.get("first_ts"),
                "last_ts": it.get("last_ts"),
                "total_messages": int(it.get("total_messages", 0) or 0),
            }
        )
    return out


def _top_10_people_by_mutuality(people: Dict[str, Any]) -> List[Dict[str, Any]]:
    """
    Mutuality = minimal imbalance |sent-recv| / total,
    BUT only for "big" conversations: total_messages >= 2000 (as requested).
    """
    rows: List[Dict[str, Any]] = []

    for it in people.values():
        if not isinstance(it, dict):
            continue

        sent = int(it.get("sent_messages") or 0)
        recv = int(it.get("received_messages") or 0)
        total = int(it.get("total_messages") or (sent + recv) or 0)

        # HARD FILTER: only big chats
        if total < 2000:
            continue

        abs_diff = abs(sent - recv)
        ratio = _safe_div(abs_diff, total)

        peer_id = it.get("peer_from_id")
        peer_key = str(peer_id) if peer_id is not None else ""

        rows.append(
            {
                "peer_from_id": peer_key,
                "display_name": it.get("display_name"),
                "sent_messages": sent,
                "received_messages": recv,
                "total_messages": total,
                "abs_diff": abs_diff,
                "imbalance_ratio": float(ratio),
            }
        )

    # lowest imbalance first, then bigger chats first, then stable id
    rows.sort(key=lambda r: (r["imbalance_ratio"], -r["total_messages"], r["peer_from_id"]))
    return rows[:10]
def _achievements(all_time: Dict[str, Any]) -> List[Dict[str, Any]]:
    total_msgs = int(all_time.get("total_messages", 0) or 0)
    night_ratio = float(all_time.get("night_messages_ratio", 0.0) or 0.0)
    median_reply = int(all_time.get("median_reply_time_to_others_seconds", 0) or 0)
    stickers = int(all_time.get("media_counts", {}).get("sticker", 0) if isinstance(all_time.get("media_counts"), dict) else 0)
    emojis_total = int(all_time.get("total_emojis_sent", 0) or 0)
    longest_len = 0
    lm = all_time.get("longest_message_sent")
    if isinstance(lm, dict):
        longest_len = int(lm.get("length_chars", 0) or 0)
    streak = 0
    st = all_time.get("longest_streak_days")
    if isinstance(st, dict):
        streak = int(st.get("length_days", 0) or 0)
    chats_total = int(all_time.get("total_chats_personal", 0) or 0)
    edited = int(all_time.get("edited_messages_count", 0) or 0)
    media_total = 0
    mc = all_time.get("media_counts")
    if isinstance(mc, dict):
        media_total = int(sum(int(v or 0) for v in mc.values()))

    def ach(id_: str, title: str, desc: str, earned: bool, score: int) -> Dict[str, Any]:
        return {
            "id": id_,
            "title": title,
            "description": desc,
            "earned": bool(earned),
            "score": int(max(0, min(100, score))),
            "badge_image_path": f"assets/badges/{id_}.png",
        }

    out: List[Dict[str, Any]] = []
    out.append(ach("night_chatter", "Night Chatter", "Пишешь ночью чаще многих.", night_ratio >= 0.25, int(min(100, night_ratio * 400))))
    out.append(ach("early_bird", "Early Bird", "Утро начинается с сообщений.", int(all_time.get("messages_06_08", 0) or 0) >= 50, int(min(100, _safe_div(int(all_time.get("messages_06_08", 0) or 0), 50) * 100))))
    out.append(ach("speed_responder", "Speed Responder", "Отвечаешь очень быстро.", 0 < median_reply <= 300, 100 if 0 < median_reply <= 300 else int(max(0, 100 - _safe_div(median_reply, 3600) * 25))))
    out.append(ach("ignorer", "Ignorer", "Иногда ответы могут подождать.", median_reply >= 2 * 24 * 3600, int(min(100, _safe_div(median_reply, 2 * 24 * 3600) * 100))))
    out.append(ach("sticker_boss", "Sticker Boss", "Стикеры — твой язык.", stickers >= 100, int(min(100, _safe_div(stickers, 100) * 100))))
    out.append(ach("emoji_master", "Emoji Master", "Эмодзи в каждом втором сообщении.", emojis_total >= 300, int(min(100, _safe_div(emojis_total, 300) * 100))))
    out.append(ach("longreader", "Longreader", "Любишь длинные сообщения.", int(all_time.get("average_msg_length_sent_chars", 0) or 0) >= 120, int(min(100, _safe_div(int(all_time.get("average_msg_length_sent_chars", 0) or 0), 120) * 100))))
    out.append(ach("wall_of_text", "Wall of Text", "Однажды ты написал целую стену текста.", longest_len >= 1000, int(min(100, _safe_div(longest_len, 1000) * 100))))
    out.append(ach("media_magnet", "Media Magnet", "Медиа-контент летит рекой.", media_total >= 500, int(min(100, _safe_div(media_total, 500) * 100))))
    out.append(ach("social_butterfly", "Social Butterfly", "Общение со многими людьми.", chats_total >= 120, int(min(100, _safe_div(chats_total, 120) * 100))))
    out.append(ach("marathoner", "Marathoner", "Писал(а) каждый день без пропусков.", streak >= 30, int(min(100, _safe_div(streak, 30) * 100))))
    out.append(ach("editor", "Editor", "Редактируешь сообщения.", edited >= 25, int(min(100, _safe_div(edited, 25) * 100))))
    out.append(ach("writer", "Writer", "Много текста за всё время.", int(all_time.get("total_words_sent", 0) or 0) >= 50000, int(min(100, _safe_div(int(all_time.get("total_words_sent", 0) or 0), 50000) * 100))))
    out.append(ach("ultra_active", "Ultra Active", "Очень много сообщений.", total_msgs >= 20000, int(min(100, _safe_div(total_msgs, 20000) * 100))))
    out.append(ach("consistent", "Consistent", "Стабильная активность по дням.", int(all_time.get("active_days_count", 0) or 0) >= 200, int(min(100, _safe_div(int(all_time.get("active_days_count", 0) or 0), 200) * 100))))

    if len(out) < 15:
        out.append(ach("placeholder", "Achievement", "(placeholder)", False, 0))
    return out


def _slides_data(report: Dict[str, Any]) -> Dict[str, Any]:
    periods = report.get("periods") if isinstance(report.get("periods"), dict) else {}
    all_time = periods.get("all_time") if isinstance(periods.get("all_time"), dict) else {}
    year = periods.get("year") if isinstance(periods.get("year"), dict) else {}
    top_people = report.get("top_people") if isinstance(report.get("top_people"), list) else []

    slides = [
        {"id": "s1_overview", "title": "Overview", "data": {"all_time": all_time, "year": year}},
        {"id": "s2_sent_vs_received", "title": "Sent vs Received", "data": {"all_time": {"sent": all_time.get("sent_messages"), "received": all_time.get("received_messages")}, "year": {"sent": year.get("sent_messages"), "received": year.get("received_messages")}}},
        {"id": "s3_activity_day", "title": "Most active day", "data": {"all_time": all_time.get("most_active_day"), "year": year.get("most_active_day")}},
        {"id": "s4_activity_month", "title": "Most active month", "data": {"all_time": all_time.get("most_active_month"), "year": year.get("most_active_month")}},
        {"id": "s5_activity_hour", "title": "Most active hour", "data": {"all_time": all_time.get("most_active_hour"), "year": year.get("most_active_hour")}},
        {"id": "s6_night", "title": "Night activity", "data": {"all_time": {"count": all_time.get("night_messages_count"), "ratio": all_time.get("night_messages_ratio")}, "year": {"count": year.get("night_messages_count"), "ratio": year.get("night_messages_ratio")}}},
        {"id": "s7_streak", "title": "Longest streak", "data": {"all_time": all_time.get("longest_streak_days"), "year": year.get("longest_streak_days")}},
        {"id": "s8_silence", "title": "Longest silence", "data": {"all_time": all_time.get("longest_silence_gap"), "year": year.get("longest_silence_gap")}},
        {"id": "s9_top_people", "title": "Top people", "data": {"top_people": top_people[:10]}},
        {"id": "s10_reply_times", "title": "Reply times", "data": {"all_time": {"median": all_time.get("median_reply_time_to_others_seconds"), "fastest": all_time.get("who_you_reply_fastest"), "slowest": all_time.get("who_you_ignore_most")}, "year": {"median": year.get("median_reply_time_to_others_seconds"), "fastest": year.get("who_you_reply_fastest"), "slowest": year.get("who_you_ignore_most")}}},
        {"id": "s11_words", "title": "Top words", "data": {"all_time": all_time.get("top_words"), "year": year.get("top_words")}},
        {"id": "s12_word_cloud", "title": "Word cloud", "data": {"all_time": all_time.get("word_cloud"), "year": year.get("word_cloud")}},
        {"id": "s13_emojis", "title": "Top emojis", "data": {"all_time": all_time.get("top_emojis"), "year": year.get("top_emojis")}},
        {"id": "s14_media", "title": "Media", "data": {"all_time": all_time.get("media_counts"), "year": year.get("media_counts")}},
        {"id": "s15_edits", "title": "Edits", "data": {"all_time": all_time.get("edited_messages_count"), "year": year.get("edited_messages_count")}},
        {"id": "s16_deleted", "title": "Deletions", "data": {"all_time": all_time.get("deleted_messages_count"), "year": year.get("deleted_messages_count")}},
        {"id": "s17_day_person", "title": "Day person", "data": {"all_time": all_time.get("day_person"), "year": year.get("day_person")}},
        {"id": "s18_night_person", "title": "Night person", "data": {"all_time": all_time.get("night_person"), "year": year.get("night_person")}},
        {"id": "s19_achievements", "title": "Achievements", "data": {"achievements": report.get("achievements")}},
        {"id": "s20_meta", "title": "Meta", "data": report.get("meta")},
    ]

    return {"version": 1, "slides": slides}


def _compute_period_metrics(
    conn: sqlite3.Connection,
    label: str,
    start_ts: int,
    end_ts: int,
    people: Dict[str, Dict[str, Any]],
    reply_stats: Dict[str, Any],
) -> Dict[str, Any]:
    if _CANCEL_EVENT.is_set():
        raise CancelledError()

    total = _count_messages(conn, start_ts, end_ts, "AND is_service = 0")
    sent = _count_messages(conn, start_ts, end_ts, "AND is_service = 0 AND is_out = 1")
    recv = _count_messages(conn, start_ts, end_ts, "AND is_service = 0 AND is_out = 0")
    service_total = _count_messages(conn, start_ts, end_ts, "AND is_service = 1")
    edited = _count_messages(conn, start_ts, end_ts, "AND is_service = 0 AND is_edited = 1")
    deleted = _deleted_messages_count(conn, start_ts, end_ts)

    most_day = _most_active_group(conn, start_ts, end_ts, f"date((date_ts + {MSK_OFFSET_SECONDS}), 'unixepoch')", "day")
    most_month = _most_active_group(conn, start_ts, end_ts, f"strftime('%Y-%m', (date_ts + {MSK_OFFSET_SECONDS}), 'unixepoch')", "month")
    most_hour = _most_active_group(conn, start_ts, end_ts, f"strftime('%H', (date_ts + {MSK_OFFSET_SECONDS}), 'unixepoch')", "hour")

    night_count = conn.execute(
        f"SELECT COUNT(*) FROM messages WHERE is_service = 0 AND date_ts >= ? AND date_ts < ? AND CAST(strftime('%H', (date_ts + {MSK_OFFSET_SECONDS}), 'unixepoch') AS INTEGER) BETWEEN 0 AND 5;",
        (start_ts, end_ts),
    ).fetchone()
    night_messages = int(night_count[0] or 0) if night_count else 0
    night_ratio = _safe_div(night_messages, total)

    active_days_count = _distinct_days_count(conn, start_ts, end_ts)
    avg_msgs_per_day = _safe_div(total, active_days_count) if active_days_count else 0.0

    silence = _longest_silence_gap(conn, start_ts, end_ts)
    streak = _longest_streak_days(conn, start_ts, end_ts)

    person_streak = _longest_person_streak(conn, start_ts, end_ts)

    textm = _text_metrics_sent(conn, start_ts, end_ts)

    textm = _text_metrics_sent(conn, start_ts, end_ts)
    media = _media_counts(conn, start_ts, end_ts)

    if label == "year":
        median_reply = int(reply_stats.get("global_median_year_seconds", 0) or 0)
        per_peer_median = reply_stats.get("per_peer_median_year_seconds", {})
        per_peer_samples = reply_stats.get("per_peer_samples_year", {})
    else:
        median_reply = int(reply_stats.get("global_median_all_time_seconds", 0) or 0)
        per_peer_median = reply_stats.get("per_peer_median_all_time_seconds", {})
        per_peer_samples = reply_stats.get("per_peer_samples_all_time", {})

    fastest: Optional[Dict[str, Any]] = None
    slowest: Optional[Dict[str, Any]] = None
    med_items = []
    if isinstance(per_peer_median, dict) and isinstance(per_peer_samples, dict):
        for peer_id, med in per_peer_median.items():
            try:
                samples = int(per_peer_samples.get(peer_id, 0) or 0)
                if samples < 3:
                    continue
                med_items.append((int(med or 0), -samples, peer_id))
            except Exception:
                continue
    med_items.sort()
    if med_items:
        fastest_peer = med_items[0][2]
        fastest = {
            "peer_from_id": fastest_peer,
            "display_name": (people.get(fastest_peer, {}) or {}).get("display_name"),
            "median_reply_seconds": int(per_peer_median.get(fastest_peer, 0) or 0) if isinstance(per_peer_median, dict) else 0,
        }
        slowest_peer = med_items[-1][2]
        slowest = {
            "peer_from_id": slowest_peer,
            "display_name": (people.get(slowest_peer, {}) or {}).get("display_name"),
            "median_reply_seconds": int(per_peer_median.get(slowest_peer, 0) or 0) if isinstance(per_peer_median, dict) else 0,
        }

    day_person = _pick_person_by_metric(people, "day_messages", reverse=True)
    night_person = _pick_person_by_metric(people, "night_messages", reverse=True)

    row_0608 = conn.execute(
        f"SELECT COUNT(*) FROM messages WHERE is_service = 0 AND date_ts >= ? AND date_ts < ? AND CAST(strftime('%H', (date_ts + {MSK_OFFSET_SECONDS}), 'unixepoch') AS INTEGER) BETWEEN 6 AND 8;",
        (start_ts, end_ts),
    ).fetchone()
    messages_0608 = int(row_0608[0] or 0) if row_0608 else 0

    metrics: Dict[str, Any] = {
        "total_messages": int(total),
        "sent_messages": int(sent),
        "received_messages": int(recv),
        "service_messages_count": int(service_total),
        "total_chats_personal": int(conn.execute("SELECT COUNT(*) FROM chats;").fetchone()[0] or 0),
        "most_active_day": most_day,
        "most_active_month": most_month,
        "most_active_hour": most_hour,
        "night_messages_count": int(night_messages),
        "night_messages_ratio": float(night_ratio),
        "media_counts": media,
        "edited_messages_count": int(edited),
        "deleted_messages_count": int(deleted),
        "median_reply_time_to_others_seconds": int(median_reply),
        "who_you_reply_fastest": fastest,
        "who_you_ignore_most": slowest,
        "day_person": {
            "peer_from_id": day_person.get("peer_from_id") if isinstance(day_person, dict) else None,
            "display_name": day_person.get("display_name") if isinstance(day_person, dict) else None,
            "messages": int(day_person.get("day_messages", 0) or 0) if isinstance(day_person, dict) else 0,
        }
        if isinstance(day_person, dict)
        else None,
        "night_person": {
            "peer_from_id": night_person.get("peer_from_id") if isinstance(night_person, dict) else None,
            "display_name": night_person.get("display_name") if isinstance(night_person, dict) else None,
            "messages": int(night_person.get("night_messages", 0) or 0) if isinstance(night_person, dict) else 0,
        }
        if isinstance(night_person, dict)
        else None,
        "longest_silence_gap": silence,
        "longest_streak_days": streak,
        "longest_person_streak": person_streak,
        "top_10_people_by_messages": _top_10_people_by_messages(people),
        "top_10_people_by_time_span": _top_10_people_by_time_span(people),
        "top_10_people_by_mutuality": _top_10_people_by_mutuality(people),
        "active_days_count": int(active_days_count),
        "avg_messages_per_active_day": float(avg_msgs_per_day),
        "messages_06_08": int(messages_0608),
    }

    metrics.update(textm)
    return metrics


def do_build_report(db_path: str) -> None:
    if _CANCEL_EVENT.is_set():
        raise CancelledError()

    if not os.path.isfile(db_path):
        raise RuntimeError("DB file not found")

    report_path = os.path.join(os.path.dirname(db_path), "report.json")

    progress("compute_metrics", 0, "", "")

    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    try:
        ensure_schema(conn)

        self_from_id = meta_get(conn, "self_from_id")
        if isinstance(self_from_id, str):
            self_from_id = self_from_id.strip() or None
        else:
            self_from_id = None

        if not self_from_id:
            progress("compute_metrics", 3, "direction", "")
            self_from_id = compute_self_from_id(conn)
            apply_direction_updates(conn, self_from_id)

        progress("compute_metrics", 6, "period_bounds", "")
        msk = _moscow_tzinfo()
        now_msk = datetime.now(msk)
        year_used = int(now_msk.year - 1)
        year_start = datetime(year_used, 1, 1, tzinfo=msk)
        year_end = datetime(year_used + 1, 1, 1, tzinfo=msk)
        year_start_ts = int(year_start.timestamp())
        year_end_ts = int(year_end.timestamp())

        progress("compute_metrics", 12, "reply_times", "")
        reply_stats = _compute_reply_times(conn, year_start_ts, year_end_ts)

        progress("compute_metrics", 22, "people_stats", "")
        people_all = _people_stats(conn, 0, 2**62)
        people_year = _people_stats(conn, year_start_ts, year_end_ts)

        per_all = reply_stats.get("per_peer_median_all_time_seconds", {})
        per_year = reply_stats.get("per_peer_median_year_seconds", {})
        samples_all = reply_stats.get("per_peer_samples_all_time", {})
        samples_year = reply_stats.get("per_peer_samples_year", {})
        if isinstance(per_all, dict) and isinstance(samples_all, dict):
            for peer_id, st in people_all.items():
                if not isinstance(st, dict):
                    continue
                st["median_reply_time_to_others_seconds"] = int(per_all.get(peer_id, 0) or 0)
                st["reply_samples"] = int(samples_all.get(peer_id, 0) or 0)
        if isinstance(per_year, dict) and isinstance(samples_year, dict):
            for peer_id, st in people_year.items():
                if not isinstance(st, dict):
                    continue
                st["median_reply_time_to_others_seconds"] = int(per_year.get(peer_id, 0) or 0)
                st["reply_samples"] = int(samples_year.get(peer_id, 0) or 0)

        progress("compute_metrics", 35, "metrics_all_time", "")
        metrics_all = _compute_period_metrics(conn, "all_time", 0, 2**62, people_all, reply_stats)

        progress("compute_metrics", 55, "metrics_year", "")
        metrics_year = _compute_period_metrics(conn, "year", year_start_ts, year_end_ts, people_year, reply_stats)

        progress("compute_metrics", 70, "top_people", "")
        all_peers = set(people_all.keys()) | set(people_year.keys())
        top_people_list: List[Dict[str, Any]] = []
        for peer_id in all_peers:
            pa = people_all.get(peer_id)
            py = people_year.get(peer_id)
            display_name = (py or pa or {}).get("display_name")
            top_people_list.append(
                {
                    "peer_from_id": peer_id,
                    "display_name": display_name,
                    "periods": {
                        "all_time": pa,
                        "year": py,
                    },
                }
            )
        top_people_list.sort(
            key=lambda x: int(((x.get("periods") or {}).get("all_time") or {}).get("total_messages", 0) or 0), reverse=True
        )

        progress("compute_metrics", 82, "achievements", "")
        achievements = _achievements(metrics_all)

        report: Dict[str, Any] = {
            "meta": {
                "generated_at": datetime.utcnow().replace(tzinfo=timezone.utc).isoformat(),
                "msk_year_used": int(year_used),
                "self_from_id": self_from_id,
            },
            "periods": {
                "all_time": metrics_all,
                "year": metrics_year,
            },
            "top_people": top_people_list,
            "achievements": achievements,
        }

        progress("compute_metrics", 90, "slides_data", "")
        report["slides_data"] = _slides_data(report)

        progress("compute_metrics", 96, "write_report", "")
        try:
            with open(report_path, "w", encoding="utf-8") as f:
                json.dump(report, f, ensure_ascii=False, indent=2)
        except Exception as e:
            raise RuntimeError(f"Failed to write report.json: {str(e)}")

        progress("compute_metrics", 100, "", "")
        write_json(
            {
                "type": "report_done",
                "db_path": db_path,
                "report_path": report_path,
                "msk_year_used": int(year_used),
                "preview": {
                    "total_messages_all_time": int(metrics_all.get("total_messages", 0) or 0),
                    "total_messages_year": int(metrics_year.get("total_messages", 0) or 0),
                    "sent_messages_all_time": int(metrics_all.get("sent_messages", 0) or 0),
                    "received_messages_all_time": int(metrics_all.get("received_messages", 0) or 0),
                    "most_active_day_all_time": metrics_all.get("most_active_day"),
                    "top_person_all_time": (metrics_all.get("top_10_people_by_messages") or [None])[0],
                },
            }
        )

    except CancelledError:
        write_json({"type": "report_error", "message": "Report generation cancelled"})
    finally:
        try:
            conn.close()
        except Exception:
            pass


def start_report_thread(db_path: str) -> None:
    global _REPORT_THREAD

    def _runner() -> None:
        try:
            do_build_report(db_path)
        except CancelledError:
            return
        except Exception as e:
            write_json({"type": "report_error", "message": str(e)})

    with _REPORT_LOCK:
        if _IMPORT_THREAD is not None and _IMPORT_THREAD.is_alive():
            write_json({"type": "report_error", "message": "Import is running"})
            return
        if _REPORT_THREAD is not None and _REPORT_THREAD.is_alive():
            write_json({"type": "report_error", "message": "Report generation already running"})
            return

        _CANCEL_EVENT.clear()
        t = threading.Thread(target=_runner, name="tgwr_report", daemon=True)
        _REPORT_THREAD = t
        t.start()


def handle_command(cmd_obj: Any) -> None:
    if not isinstance(cmd_obj, dict):
        write_json({"type": "error", "message": "Command must be a JSON object"})
        return

    cmd = cmd_obj.get("cmd")

    if cmd == "ping":
        write_json({"type": "pong", "version": VERSION})
        return

    if cmd == "cancel":
        _CANCEL_EVENT.set()
        return

    if cmd == "import_export":
        export_dir = cmd_obj.get("export_dir")
        mode = cmd_obj.get("mode")
        db_path = cmd_obj.get("db_path")

        if not isinstance(export_dir, str) or not export_dir:
            write_json({"type": "error", "message": "import_export: export_dir must be a non-empty string"})
            return
        if not isinstance(mode, str) or not mode:
            write_json({"type": "error", "message": "import_export: mode must be a non-empty string"})
            return
        if not isinstance(db_path, str) or not db_path:
            write_json({"type": "error", "message": "import_export: db_path must be a non-empty string"})
            return
        if not os.path.isdir(export_dir):
            write_json({"type": "error", "message": "Export directory does not exist or is not a directory"})
            return

        start_import_thread(export_dir=export_dir, mode=mode, db_path=db_path)
        return

    if cmd == "build_report":
        db_path = cmd_obj.get("db_path")
        if not isinstance(db_path, str) or not db_path:
            write_json({"type": "report_error", "message": "build_report: db_path must be a non-empty string"})
            return
        if not os.path.isfile(db_path):
            write_json({"type": "report_error", "message": "DB path does not exist"})
            return
        start_report_thread(db_path=db_path)
        return

    write_json({"type": "error", "message": f"unknown_cmd: {cmd}"})


def main() -> None:
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue

        try:
            cmd_obj = json.loads(line)
        except Exception as e:
            write_json({"type": "error", "message": f"invalid_json: {str(e)}"})
            continue

        try:
            handle_command(cmd_obj)
        except Exception as e:
            write_json({"type": "error", "message": f"exception: {str(e)}"})


if __name__ == "__main__":
    main()