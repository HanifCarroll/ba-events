-- Lexical event search on D1: the FTS5 replacement for Postgres' to_tsvector('simple', ...) over events.
--
-- `events_fts` is an external-content index over `events` (it stores only the index; the text stays in `events`),
-- keyed by the events rowid. It indexes the three columns Postgres' search document is built from: `search_document`,
-- and `name` and `description_es` for rows without one. The venue name Postgres appends is already in every scheduled
-- event's `search_document` ("Venue: ..."), and an external-content index can only hold columns of `events`.
-- `unicode61 remove_diacritics 2` folds case and accents, so "musica" finds "Música" (Postgres' 'simple' config didn't).
--
-- Three triggers keep it in step with `events`. An update re-indexes the row only when one of the three columns
-- changes. Rebuild it from scratch with: INSERT INTO events_fts(events_fts) VALUES ('rebuild');
CREATE VIRTUAL TABLE events_fts USING fts5(
  search_document,
  name,
  description_es,
  content = 'events',
  content_rowid = 'rowid',
  tokenize = 'unicode61 remove_diacritics 2'
);

CREATE TRIGGER events_fts_after_insert AFTER INSERT ON events BEGIN
  INSERT INTO events_fts (rowid, search_document, name, description_es)
  VALUES (NEW.rowid, NEW.search_document, NEW.name, NEW.description_es);
END;

CREATE TRIGGER events_fts_after_delete AFTER DELETE ON events BEGIN
  INSERT INTO events_fts (events_fts, rowid, search_document, name, description_es)
  VALUES ('delete', OLD.rowid, OLD.search_document, OLD.name, OLD.description_es);
END;

CREATE TRIGGER events_fts_after_update AFTER UPDATE OF search_document, name, description_es ON events BEGIN
  INSERT INTO events_fts (events_fts, rowid, search_document, name, description_es)
  VALUES ('delete', OLD.rowid, OLD.search_document, OLD.name, OLD.description_es);
  INSERT INTO events_fts (rowid, search_document, name, description_es)
  VALUES (NEW.rowid, NEW.search_document, NEW.name, NEW.description_es);
END;

-- Rows already in `events` (a database migrated after the copy) get indexed too. A no-op on an empty table.
INSERT INTO events_fts (events_fts) VALUES ('rebuild');
