CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

CREATE TABLE classes (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  professor_name VARCHAR(255) NOT NULL,
  class_name VARCHAR(255) NOT NULL,
  status VARCHAR(50) NOT NULL DEFAULT 'ACTIVE',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  ended_at TIMESTAMP
);

CREATE TABLE attendances (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  class_id UUID NOT NULL REFERENCES classes(id),
  input_type VARCHAR(50) NOT NULL, -- 'RFID' or 'MANUAL'
  student_document VARCHAR(100) NOT NULL,
  student_name VARCHAR(255),
  student_photo TEXT, -- Base64
  course_name VARCHAR(255),
  situator_id INTEGER,
  lyceum_validated BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
