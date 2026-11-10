-- You are free to change this schema. If you do, say why in NOTES.md.

create table jobs (
    id uuid primary key default gen_random_uuid (),
    title text not null,
    location text not null,
    description text not null,
    created_at timestamptz not null default now()
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
    source_quote text
);

create index requirements_job_position_idx on requirements (job_id, position);