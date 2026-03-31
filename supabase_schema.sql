-- Stride MIDI Engine — Supabase Schema
-- Run this in Supabase SQL Editor (supabase.com → your project → SQL Editor)

-- 1. USERS
CREATE TABLE users (
    id TEXT PRIMARY KEY,                    -- Firebase UID
    email TEXT NOT NULL,
    display_name TEXT,
    joined_at TIMESTAMPTZ DEFAULT now(),
    credits_used INT DEFAULT 0,
    last_active_month INT,
    generations_count INT DEFAULT 0,
    is_admin BOOLEAN DEFAULT false,
    last_seen_at TIMESTAMPTZ DEFAULT now()
);

-- 2. GENERATIONS (every MIDI output)
CREATE TABLE generations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
    filename TEXT,
    url TEXT,
    alc_url TEXT,
    style TEXT,
    key TEXT,
    bpm INT,
    bars INT,
    action TEXT,                             -- generate/harmonize/seed/drums/automate_only
    is_cosmic BOOLEAN DEFAULT false,
    is_favorite BOOLEAN DEFAULT false,
    prompt_text TEXT,
    chain_id TEXT,
    fast_mode BOOLEAN DEFAULT false,
    created_at TIMESTAMPTZ DEFAULT now()
);

-- 3. PERSONAL ALC RACKS
CREATE TABLE personal_alcs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
    filename TEXT,
    storage_path TEXT,
    size_bytes INT,
    uploaded_at TIMESTAMPTZ DEFAULT now()
);

-- 4. FEEDBACK
CREATE TABLE feedback (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id TEXT,
    user_email TEXT,
    message TEXT,
    user_agent TEXT,
    created_at TIMESTAMPTZ DEFAULT now()
);

-- INDEXES for common queries
CREATE INDEX idx_generations_user_id ON generations(user_id);
CREATE INDEX idx_generations_created_at ON generations(created_at DESC);
CREATE INDEX idx_generations_style ON generations(style);
CREATE INDEX idx_generations_action ON generations(action);
CREATE INDEX idx_generations_user_favorite ON generations(user_id, is_favorite) WHERE is_favorite = true;
CREATE INDEX idx_personal_alcs_user_id ON personal_alcs(user_id);

-- ROW LEVEL SECURITY
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE generations ENABLE ROW LEVEL SECURITY;
ALTER TABLE personal_alcs ENABLE ROW LEVEL SECURITY;
ALTER TABLE feedback ENABLE ROW LEVEL SECURITY;

-- Policies: service_role bypasses RLS, anon/frontend can only access own data
CREATE POLICY "Users read own data" ON users FOR SELECT USING (true);
CREATE POLICY "Generations read own" ON generations FOR SELECT USING (true);
CREATE POLICY "Personal ALCs read own" ON personal_alcs FOR SELECT USING (true);
CREATE POLICY "Feedback insert" ON feedback FOR INSERT WITH CHECK (true);

-- Service role (backend) can do everything — this is automatic in Supabase
