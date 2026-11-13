-- You are free to change this schema. If you do, say why in NOTES.md.

create table jobs (
    id uuid primary key default gen_random_uuid (),
    title text not null,
    location text not null,
    description text not null,
    created_at timestamptz not null default now(),
    -- last recruiter write to this job's requirements (add, edit, approve,
    -- delete); null = never touched. Approving the job does not set it.
    updated_at timestamptz,
    -- set when the recruiter approves the job; null = not reviewed. Any later
    -- requirement write clears it (and reviewed_by), so the job needs approving again.
    reviewed_at timestamptz,
    -- who approved the job; null exactly when reviewed_at is null
    reviewed_by text,
    constraint jobs_review_both_or_neither check (
        (reviewed_at is null) = (reviewed_by is null)
    )
);

create table requirements (
    id uuid primary key default gen_random_uuid (),
    job_id uuid not null references jobs (id) on delete cascade,
    text text not null,
    -- must_have  : the recruiter treats this as a bar
    -- nice_to_have: it counts for something, it is not a bar
    kind text not null check (
        kind in ('must_have', 'nice_to_have')
    ),
    -- extracted : came out of the job description, untouched
    -- edited    : a recruiter changed the text
    -- added     : a recruiter wrote it themselves
    origin text not null check (
        origin in (
            'extracted',
            'edited',
            'added'
        )
    ),
    -- 1-based display order within a job
    position integer not null,
    -- the phrase in the job description this requirement was taken from;
    -- null when the extractor found nothing in the text to base it on
    source_quote text,
    created_at timestamptz not null default now(),
    -- time of the last write to this row. It is also the concurrency token: a
    -- write must send back the value it read, or it is rejected as stale.
    -- Writes set it with clock_timestamp(), so each write gets a later value.
    updated_at timestamptz not null default now(),
    -- recruiter who last wrote this row; null = untouched extraction
    updated_by text,
    -- set when a recruiter approves the requirement; null = not approved
    reviewed_at timestamptz,
    -- deferred, so a delete can shift the later rows up one in a single
    -- transaction without tripping over each other
    constraint requirements_job_position_key unique (job_id, position) deferrable initially deferred
);