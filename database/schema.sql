-- ============================================================
-- Novus Epoxy — Schéma MySQL
-- Exécuter dans phpMyAdmin sur Hostinger
-- ============================================================

CREATE TABLE IF NOT EXISTS submissions (
  id           INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  nom          VARCHAR(120) NOT NULL,
  email        VARCHAR(255) NOT NULL,
  telephone    VARCHAR(30),
  message      TEXT,
  service      VARCHAR(80),
  statut       ENUM('nouveau','lu','en_traitement','ferme') DEFAULT 'nouveau',
  ip_hash      CHAR(64),
  created_at   DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at   DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_statut (statut),
  INDEX idx_created (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS email_logs (
  id            INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  resend_id     VARCHAR(100) UNIQUE,
  destinataire  VARCHAR(255) NOT NULL,
  sujet         VARCHAR(500),
  statut        ENUM('sent','delivered','opened','clicked','bounced','complained') DEFAULT 'sent',
  submission_id INT UNSIGNED,
  opened_at     DATETIME,
  clicked_at    DATETIME,
  created_at    DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (submission_id) REFERENCES submissions(id) ON DELETE SET NULL,
  INDEX idx_resend_id (resend_id),
  INDEX idx_statut (statut)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS page_views (
  id           BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  url_path     VARCHAR(500) NOT NULL,
  referrer     VARCHAR(500),
  user_agent   VARCHAR(500),
  visitor_hash CHAR(64),
  session_hash CHAR(64),
  duree_sec    SMALLINT UNSIGNED,
  created_at   DATETIME DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_path (url_path(100)),
  INDEX idx_created (created_at),
  INDEX idx_visitor (visitor_hash)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS events (
  id           BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  type         VARCHAR(80) NOT NULL,
  url_path     VARCHAR(500),
  valeur       VARCHAR(255),
  visitor_hash CHAR(64),
  created_at   DATETIME DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_type (type),
  INDEX idx_created (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
