-- Contract renewal bot — database schema (MySQL)
-- Matches the schema created programmatically by db.py — this file exists
-- so you can inspect, hand-run, or version-control the schema separately,
-- and to seed sample data for testing.
--
-- Run it with:
--   mysql -u root -p < schema.sql
-- (or, after creating the database yourself: mysql -u root -p contract_bot < schema.sql)

CREATE DATABASE IF NOT EXISTS contract_bot
    CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

USE contract_bot;

-- ---------------------------------------------------------------------
-- Table: imap_cursor
-- NEW (not in the original schema): tracks the last IMAP UID processed
-- per mailbox. Needed because the reply-poll now runs as a short-lived
-- Vercel Cron invocation instead of an always-running process, so it
-- can't just keep an in-memory "last seen" pointer between runs.
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS imap_cursor (
    mailbox     VARCHAR(255) PRIMARY KEY,
    last_uid    BIGINT NOT NULL DEFAULT 0,
    updated_at  DATETIME NOT NULL
) ENGINE=InnoDB;

-- ---------------------------------------------------------------------
-- Table: contracts
-- One row per client contract. template_path points to the original PDF
-- on disk in your local contract_templates/ folder — the bot attaches it
-- when reaching out and compares returned copies against it.
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS contracts (
    id                INT AUTO_INCREMENT PRIMARY KEY,
    client_name       VARCHAR(255) NOT NULL,
    client_email      VARCHAR(255) NOT NULL,
    contract_link     TEXT,                                    -- optional external URL (e.g. Drive/Dropbox link)
    template_path     VARCHAR(500),                             -- path to the original contract PDF on disk
    expiry_date       DATE NOT NULL,
    status            VARCHAR(30) NOT NULL DEFAULT 'active',    -- active, renewal_sent, pending_confirmation, renewed, expired, cancelled, flagged
    signature_status  VARCHAR(20) NOT NULL DEFAULT 'unknown',   -- unknown, signed, missing
    match_status      VARCHAR(20) NOT NULL DEFAULT 'unknown',   -- unknown, match, mismatch
    ai_managed        TINYINT(1) NOT NULL DEFAULT 1,            -- 1 = AI handles it, 0 = human has taken over
    created_at        DATETIME NOT NULL,
    updated_at        DATETIME NOT NULL,
    INDEX idx_contracts_client_email (client_email),
    INDEX idx_contracts_expiry_date (expiry_date),
    INDEX idx_contracts_status (status)
) ENGINE=InnoDB;

-- ---------------------------------------------------------------------
-- Table: conversations
-- Full log of every email in and out, per contract. Powers the
-- dashboard's conversation viewer.
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS conversations (
    id              INT AUTO_INCREMENT PRIMARY KEY,
    contract_id     INT NOT NULL,
    direction       VARCHAR(10) NOT NULL,   -- 'outbound' (bot/employee -> client) or 'inbound' (client -> bot)
    sender          VARCHAR(255) NOT NULL,
    subject         TEXT,
    body            TEXT,
    timestamp       DATETIME NOT NULL,
    FOREIGN KEY (contract_id) REFERENCES contracts (id),
    INDEX idx_conversations_contract_id (contract_id)
) ENGINE=InnoDB;

-- ---------------------------------------------------------------------
-- Table: escalations
-- Cards in the dashboard queue: cases the AI could not resolve, or
-- renewals that are ready and waiting on a human's final confirmation.
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS escalations (
    id                INT AUTO_INCREMENT PRIMARY KEY,
    contract_id       INT NOT NULL,
    reason            VARCHAR(40) NOT NULL,  -- changes_requested, classification_failed, no_contract_attached,
                                              -- contract_mismatch, signature_check_failed, ready_for_confirmation
    ai_summary        TEXT,
    status            VARCHAR(20) NOT NULL DEFAULT 'open',   -- open, resolved
    created_at        DATETIME NOT NULL,
    resolved_at       DATETIME,
    resolved_by       VARCHAR(255),
    resolution_notes  TEXT,
    FOREIGN KEY (contract_id) REFERENCES contracts (id),
    INDEX idx_escalations_status (status)
) ENGINE=InnoDB;


-- =======================================================================
-- Sample data — five contracts covering every workflow state, so you can
-- test the dashboard and scheduler without waiting on real emails.
-- Update template_path values to match wherever your PDFs actually live.
-- =======================================================================

INSERT INTO contracts
    (client_name, client_email, contract_link, template_path, expiry_date, status, signature_status, match_status, ai_managed, created_at, updated_at)
VALUES
    -- 1. Fresh contract, nothing has happened yet
    ('Company A Retail LLP', 'contracts@companya.example.com',
     'https://drive.example.com/companya-contract',
     'contract_templates/sample_contract_company_a.pdf',
     '2026-08-10', 'active', 'unknown', 'unknown', 1,
     '2026-01-15 09:00:00', '2026-01-15 09:00:00'),

    -- 2. Reminder already sent, waiting on a client reply
    ('Northwind Traders Pvt Ltd', 'ops@northwind.example.com',
     'https://drive.example.com/northwind-contract',
     'contract_templates/sample_contract_northwind.pdf',
     '2026-07-18', 'renewal_sent', 'unknown', 'unknown', 1,
     '2026-01-10 09:00:00', '2026-07-01 09:00:00'),

    -- 3. Client confirmed, signed contract matched the template — waiting on human final confirmation
    ('Bluepeak Logistics', 'admin@bluepeak.example.com',
     'https://drive.example.com/bluepeak-contract',
     'contract_templates/sample_contract_bluepeak.pdf',
     '2026-07-25', 'pending_confirmation', 'signed', 'match', 1,
     '2026-01-05 09:00:00', '2026-07-02 14:30:00'),

    -- 4. Client requested changes — escalated, needs an executive to step in
    ('Solace Interiors', 'hello@solace.example.com',
     'https://drive.example.com/solace-contract',
     'contract_templates/sample_contract_solace.pdf',
     '2026-07-20', 'active', 'unknown', 'unknown', 1,
     '2026-01-08 09:00:00', '2026-07-01 11:15:00'),

    -- 5. Fully renewed and closed out, AI handed control back to human for this account
    ('Company A Retail LLP - Warehouse Division', 'warehouse@companya.example.com',
     'https://drive.example.com/companya-warehouse-contract',
     'contract_templates/sample_contract_company_a.pdf',
     '2027-01-15', 'renewed', 'signed', 'match', 0,
     '2025-06-01 09:00:00', '2026-01-15 16:00:00');


-- Conversation history for contract 3 (Bluepeak) — the pending-confirmation case
INSERT INTO conversations (contract_id, direction, sender, subject, body, timestamp) VALUES
    (3, 'outbound', 'bot@yourcompany.example.com', 'Your contract renewal is coming up',
     'Hi Bluepeak Logistics, your contract is set to expire on 2026-07-25. Please review the attached contract and confirm renewal at your earliest convenience.',
     '2026-07-01 09:00:00'),
    (3, 'inbound', 'admin@bluepeak.example.com', 'Re: Your contract renewal is coming up',
     'Hi, confirming we would like to renew as-is. Signed copy attached.',
     '2026-07-02 14:20:00');

-- Conversation history for contract 4 (Solace) — the changes-requested case
INSERT INTO conversations (contract_id, direction, sender, subject, body, timestamp) VALUES
    (4, 'outbound', 'bot@yourcompany.example.com', 'Your contract renewal is coming up',
     'Hi Solace Interiors, your contract is set to expire on 2026-07-20. Please review the attached contract and confirm renewal at your earliest convenience.',
     '2026-07-01 09:00:00'),
    (4, 'inbound', 'hello@solace.example.com', 'Re: Your contract renewal is coming up',
     'We would like to renew, but can we revise the payment terms to Net 45 instead of Net 30, and add a clause for priority support?',
     '2026-07-01 11:10:00'),
    (4, 'outbound', 'bot@yourcompany.example.com', 'Re: Your contract renewal is coming up',
     'Thanks for letting us know. As an automated assistant I am not able to make decisions on contract terms, but a member of our team will follow up with you shortly to discuss the changes.',
     '2026-07-01 11:12:00');

-- Escalation card for contract 3 (Bluepeak) — ready for a human's final confirmation
INSERT INTO escalations (contract_id, reason, ai_summary, status, created_at) VALUES
    (3, 'ready_for_confirmation',
     'Bluepeak Logistics confirmed renewal with no changes. The returned contract text matches the original template and includes a valid signature. Ready for final sign-off.',
     'open', '2026-07-02 14:30:00');

-- Escalation card for contract 4 (Solace) — needs a human because AI cannot decide on terms
INSERT INTO escalations (contract_id, reason, ai_summary, status, created_at) VALUES
    (4, 'changes_requested',
     'Solace Interiors wants to renew but is requesting two changes: extending payment terms from Net 30 to Net 45, and adding a priority support clause. AI acknowledged and cannot approve these changes itself.',
     'open', '2026-07-01 11:15:00');
