insert into
    jobs (
        id,
        title,
        location,
        description
    )
values (
        '11111111-1111-4111-8111-111111111111',
        'Senior Full Stack Engineer',
        'Remote - Canada',
        'We are a 30-person product team building tools for hospital staffing. You will own features end to end, from the database up through the screens people use every day. Our stack is TypeScript, React and Next.js on the front, Python and PostgreSQL behind it, all on AWS. You will work directly with two designers and a product manager, ship most weeks, and be on a light on-call rotation. We want someone who has carried a product past its first hundred customers and knows which corners are safe to cut. The team is distributed across Canada and overlaps on Eastern Time for the middle of the day.'
    ),
    (
        '22222222-2222-4222-8222-222222222222',
        'Registered Nurse - Long Term Care',
        'Toronto, ON',
        'A 180-bed long term care residence is hiring registered nurses for its day and evening rotation. You will lead a care team of personal support workers, run medication passes, manage wound care and skin integrity, and be the first clinical judgement on any change in a resident''s condition. Charting is done in an electronic record at the point of care. Families are present and involved, so clear, calm communication matters as much as clinical skill. We are a unionized site with a stable staffing ratio and a full orientation period for anyone new to long term care.'
    ),
    (
        '33333333-3333-4333-8333-333333333333',
        'Warehouse Associate - Night Shift',
        'Mississauga, ON',
        'Our distribution centre runs overnight to get orders onto trucks before the morning. As an associate you will pick and pack orders against a handheld scanner, break down incoming pallets, keep aisles clear and safe, and help load outbound trailers. The floor is busy and physical, and the pace holds steady through the shift. Training is paid and takes about a week. This is a permanent position with a shift premium, a benefits package after ninety days, and a clear path onto the equipment operator team for anyone who wants it.'
    );

-- Job 1: Senior Full Stack Engineer
insert into
    requirements (
        id,
        job_id,
        text,
        kind,
        origin,
        position,
        source_quote
    )
values
    (
        '8376cdca-71e7-9cc0-129e-a1ee40c25049',
        '11111111-1111-4111-8111-111111111111',
        '5+ years building and shipping production web applications',
        'must_have',
        'extracted',
        '1',
        'carried a product past its first hundred customers'
    ),
    (
        '8bfd779f-ca3f-c2d9-7490-58b57430f8d8',
        '11111111-1111-4111-8111-111111111111',
        'Strong TypeScript and React experience',
        'must_have',
        'extracted',
        '2',
        'Our stack is TypeScript, React and Next.js on the front'
    ),
    (
        '42cfd92f-4193-c7c8-151a-5224685ab64b',
        '11111111-1111-4111-8111-111111111111',
        'Designs and queries relational databases, PostgreSQL preferred',
        'must_have',
        'extracted',
        '3',
        'Python and PostgreSQL behind it'
    ),
    (
        '0a7f585b-4ca7-13b0-5951-ca718b34e368',
        '11111111-1111-4111-8111-111111111111',
        'Must be a native English speaker',
        'must_have',
        'extracted',
        '4',
        null
    ),
    (
        'b8ab451e-a146-d41a-de66-5a2d039deedb',
        '11111111-1111-4111-8111-111111111111',
        'Available for the middle of the day on Eastern Time',
        'must_have',
        'extracted',
        '5',
        'overlaps on Eastern Time for the middle of the day'
    ),
    (
        '6fbe0a9a-fcc2-beda-af51-7c8765f8d68d',
        '11111111-1111-4111-8111-111111111111',
        'Bachelor''s degree in Computer Science',
        'must_have',
        'extracted',
        '6',
        null
    ),
    (
        '0cd4d82e-51e6-8e25-5a3b-b56f09aec9a8',
        '11111111-1111-4111-8111-111111111111',
        'No employment gaps longer than six months',
        'must_have',
        'extracted',
        '7',
        null
    ),
    (
        '5b5c7f04-ccde-7cc0-3ac0-658e1eb1d66b',
        '11111111-1111-4111-8111-111111111111',
        'Experience with Next.js or a comparable framework',
        'nice_to_have',
        'extracted',
        '8',
        'Our stack is TypeScript, React and Next.js on the front'
    ),
    (
        '1f72bc18-b45d-c026-e512-0f55fe4f5efd',
        '11111111-1111-4111-8111-111111111111',
        'Has worked at a company of under fifty people',
        'nice_to_have',
        'extracted',
        '9',
        'We are a 30-person product team'
    ),
    (
        '5df8b6df-448f-ee34-53e3-c524db5d2186',
        '11111111-1111-4111-8111-111111111111',
        'Comfortable being on a light on-call rotation',
        'nice_to_have',
        'extracted',
        '10',
        'be on a light on-call rotation'
    );

-- Job 2: Registered Nurse - Long Term Care
insert into
    requirements (
        id,
        job_id,
        text,
        kind,
        origin,
        position,
        source_quote
    )
values
    (
        'cb38210e-e739-66c8-d061-be6d23202777',
        '22222222-2222-4222-8222-222222222222',
        'Active RN licence with the College of Nurses of Ontario',
        'must_have',
        'extracted',
        '1',
        'hiring registered nurses'
    ),
    (
        '60c26f3e-867f-3481-1b25-599b5e023e92',
        '22222222-2222-4222-8222-222222222222',
        '2+ years in long term care or geriatrics',
        'must_have',
        'extracted',
        '2',
        null
    ),
    (
        'b25f954d-64a3-4764-dfda-8079abbf3408',
        '22222222-2222-4222-8222-222222222222',
        'Current CPR and BLS certification',
        'must_have',
        'extracted',
        '3',
        null
    ),
    (
        '0c4dbe0b-5dcd-119f-3fbd-76da4dc8f6be',
        '22222222-2222-4222-8222-222222222222',
        'Available for a rotating day and evening schedule',
        'must_have',
        'extracted',
        '4',
        'for its day and evening rotation'
    ),
    (
        'e9996e5c-e147-018e-cdc4-25742ed90423',
        '22222222-2222-4222-8222-222222222222',
        'Lives within a thirty minute drive of the residence',
        'must_have',
        'extracted',
        '5',
        null
    ),
    (
        'fead8c7b-8fe5-20f9-0988-0ec7e74e6d90',
        '22222222-2222-4222-8222-222222222222',
        'Confident with medication administration and wound care',
        'must_have',
        'extracted',
        '6',
        'run medication passes, manage wound care and skin integrity'
    ),
    (
        'fbd21de1-9750-b83b-07c1-73926448db7f',
        '22222222-2222-4222-8222-222222222222',
        'Clear vulnerable sector police check',
        'must_have',
        'extracted',
        '7',
        null
    ),
    (
        'c05431e6-5076-599d-1a1e-6109af029f84',
        '22222222-2222-4222-8222-222222222222',
        'Recent graduate, under two years since finishing school',
        'must_have',
        'extracted',
        '8',
        null
    ),
    (
        '847c263e-cff5-268a-f31f-12e77c8601c1',
        '22222222-2222-4222-8222-222222222222',
        'Has charted in PointClickCare or a comparable record system',
        'nice_to_have',
        'extracted',
        '9',
        'Charting is done in an electronic record at the point of care'
    ),
    (
        '33fd5f94-94d5-2868-cc22-efb3a1015155',
        '22222222-2222-4222-8222-222222222222',
        'Speaks a second language used by residents',
        'nice_to_have',
        'extracted',
        '10',
        null
    ),
    (
        'cab8618c-ac21-ee11-dc42-2518109d5f06',
        '22222222-2222-4222-8222-222222222222',
        'Has mentored personal support workers or nursing students',
        'nice_to_have',
        'extracted',
        '11',
        'lead a care team of personal support workers'
    );

-- Job 3: Warehouse Associate - Night Shift
insert into
    requirements (
        id,
        job_id,
        text,
        kind,
        origin,
        position,
        source_quote
    )
values
    (
        '5abb2585-231f-ebe2-3b7e-3ffecf87bb1b',
        '33333333-3333-4333-8333-333333333333',
        'Lifts up to fifty pounds repeatedly across an eight hour shift',
        'must_have',
        'extracted',
        '1',
        'The floor is busy and physical'
    ),
    (
        '0209b3d1-0ec5-363c-b6d8-967a8aff1142',
        '33333333-3333-4333-8333-333333333333',
        'Available Sunday through Thursday, 11pm to 7am',
        'must_have',
        'extracted',
        '2',
        'Our distribution centre runs overnight'
    ),
    (
        'f61963ce-f62f-d490-7d58-d0a4142e932b',
        '33333333-3333-4333-8333-333333333333',
        'Supplies their own steel toed safety boots',
        'must_have',
        'extracted',
        '3',
        null
    ),
    (
        '0b096495-96f5-c9c5-ad9c-23461b9a5a1b',
        '33333333-3333-4333-8333-333333333333',
        'Has their own reliable transportation',
        'must_have',
        'extracted',
        '4',
        null
    ),
    (
        'e5d2e3f3-bc3e-1e23-ddd4-0281790c9708',
        '33333333-3333-4333-8333-333333333333',
        'Reads and follows written safety instructions in English',
        'must_have',
        'extracted',
        '5',
        null
    ),
    (
        '8f100797-8f1c-7713-e1f7-9185acbfb2c0',
        '33333333-3333-4333-8333-333333333333',
        'High school diploma or equivalent',
        'must_have',
        'extracted',
        '6',
        null
    ),
    (
        '6a608a44-0c53-a50e-7818-7ad10374cec0',
        '33333333-3333-4333-8333-333333333333',
        'Forklift certification',
        'nice_to_have',
        'extracted',
        '7',
        'a clear path onto the equipment operator team'
    ),
    (
        '08fd3ba6-5059-6290-bda3-ac3a54103888',
        '33333333-3333-4333-8333-333333333333',
        'Previous warehouse or distribution centre experience',
        'nice_to_have',
        'extracted',
        '8',
        null
    ),
    (
        '95c87e4b-998c-2ee3-f79d-8c410548bfd1',
        '33333333-3333-4333-8333-333333333333',
        'Has used a handheld scanner on a pick line',
        'nice_to_have',
        'extracted',
        '9',
        'pick and pack orders against a handheld scanner'
    );
