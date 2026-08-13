require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');
const axios = require('axios');
const https = require('https');

const app = express();
app.use(cors());
app.use(express.json());

const port = process.env.PORT || 3000;

const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: process.env.DB_PORT || 5432,
  user: process.env.DB_USER || 'presence_user',
  password: process.env.DB_PASS || 'presence_password',
  database: process.env.DB_NAME || 'presence_db',
});

// Middleware for DB connection errors
pool.on('error', (err, client) => {
  console.error('Unexpected error on idle client', err);
  process.exit(-1);
});

// ==========================================
// Integrations
// ==========================================
async function getSituatorPerson(input, type) {
  try {
    const auth = Buffer.from(`${process.env.SITUATOR_USER}:${process.env.SITUATOR_PASS}`).toString('base64');
    const endpointPath = type === 'RFID' ? `/person/card/${input}` : `/person/document/${input}`;

    // SITUATOR_URL = http://network-services-middleware-situator.intranet.local/api/v1
    const agent = new https.Agent({
      rejectUnauthorized: false
    });
    const response = await axios.get(`${process.env.SITUATOR_URL}${endpointPath}`, {
      headers: { 'Authorization': `Basic ${auth}` },
      timeout: 5000, // Resiliency
      httpsAgent: agent
    });
    return response.data;
  } catch (error) {
    if (error.response && error.response.status === 404) {
      return null;
    }
    console.error("Situator API Error:", error.message);
    throw new Error('Falha ao consultar base de acesso (Situator).');
  }
}

async function getLyceumStudent(document) {
  try {
    const response = await axios.get(`${process.env.LYCEUM_URL}/alunos/${document}`, { timeout: 3000 });
    return response.data;
  } catch (error) {
    console.error("Lyceum Student API Error:", error.message);
    return null; // Fallback
  }
}

async function getLyceumPhoto(codPessoa) {
  try {
    const response = await axios.post(`${process.env.LYCEUM_URL}/pessoas/foto`, { codPessoa: codPessoa.toString() }, { timeout: 3000 });
    // Assuming response.data is Hexadecimal string
    const hex = response.data;
    if (typeof hex === 'string') {
      return Buffer.from(hex, 'hex').toString('base64');
    }
    return null;
  } catch (error) {
    console.error("Lyceum Photo API Error:", error.message);
    return null;
  }
}

// ==========================================
// Routes
// ==========================================

// Get active / recent classes
app.get('/api/sessions', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM classes ORDER BY created_at DESC LIMIT 10');
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Create or resume a session
app.post('/api/sessions', async (req, res) => {
  const { professor_name, class_name, id, min_permanence_minutes } = req.body;
  try {
    if (id) {
      // Resume
      const result = await pool.query('SELECT * FROM classes WHERE id = $1', [id]);
      if (result.rows.length > 0) return res.json(result.rows[0]);
      return res.status(404).json({ error: 'Session not found' });
    }
    // Check if active exists, else create new
    const query = 'INSERT INTO classes (professor_name, class_name, min_permanence_minutes) VALUES ($1, $2, $3) RETURNING *';
    const result = await pool.query(query, [professor_name, class_name, min_permanence_minutes || 60]);
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// End class
app.post('/api/sessions/:id/end', async (req, res) => {
  try {
    const result = await pool.query('UPDATE classes SET status = $1, ended_at = CURRENT_TIMESTAMP WHERE id = $2 RETURNING *', ['ENDED', req.params.id]);
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Resume class
app.post('/api/sessions/:id/resume', async (req, res) => {
  try {
    const result = await pool.query('UPDATE classes SET status = $1 WHERE id = $2 RETURNING *', ['ACTIVE', req.params.id]);
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Delete class
app.delete('/api/sessions/:id', async (req, res) => {
  try {
    await pool.query('DELETE FROM attendances WHERE class_id = $1', [req.params.id]);
    const result = await pool.query('DELETE FROM classes WHERE id = $1 RETURNING *', [req.params.id]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'Not found' });
    res.json({ message: 'Deleted successfully' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Update class minimum permanence
app.patch('/api/sessions/:id/min-permanence', async (req, res) => {
  const { min_permanence_minutes } = req.body;
  if (min_permanence_minutes === undefined) return res.status(400).json({ error: 'Missing min_permanence_minutes' });
  try {
    const result = await pool.query(
      'UPDATE classes SET min_permanence_minutes = $1 WHERE id = $2 RETURNING *',
      [min_permanence_minutes, req.params.id]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Not found' });
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get session by Id
app.get('/api/sessions/:id', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM classes WHERE id = $1', [req.params.id]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'Not found' });
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get session attendances
app.get('/api/sessions/:id/attendances', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM attendances WHERE class_id = $1 ORDER BY created_at DESC', [req.params.id]);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Delete attendance record
app.delete('/api/attendances/:id', async (req, res) => {
  try {
    const result = await pool.query('DELETE FROM attendances WHERE id = $1 RETURNING *', [req.params.id]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'Not found' });
    res.json({ message: 'Deleted successfully', attendance: result.rows[0] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Register attendance
app.post('/api/attendance', async (req, res) => {
  const { classId, input_value, input_type } = req.body; // type: 'RFID' ou 'MANUAL'

  if (!classId || !input_value || !['RFID', 'MANUAL', 'FACIAL', 'CPF'].includes(input_type)) {
    return res.status(400).json({ error: 'Invalid payload' });
  }

  try {
    let documentToSearch = input_value;
    let student_name = 'Aluno (Entrada Manual)';
    if (input_type === 'CPF') {
      student_name = input_value.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, "$1.$2.$3-$4");
    }
    let situator_id = null;

    // Passo 2: Situator (Apenas para RFID)
    if (input_type === 'RFID') {
      let person = null;
      
      const fetchPerson = async (val) => {
        let p = await getSituatorPerson(val, 'RFID');
        if (Array.isArray(p)) p = p[0];
        return p;
      };

      // Checagem inteligente: verifica se contém letras (hexa explícito)
      if (/[a-fA-F]/.test(input_value)) {
        const decValue = parseInt(input_value, 16).toString();
        person = await fetchPerson(decValue);
      } else {
        // Apenas números. Tenta primeiro como decimal original.
        person = await fetchPerson(input_value);
        
        // Se não encontrar, assume que pode ser um hexa contendo apenas números e converte.
        if (!person) {
          const decFromHex = parseInt(input_value, 16).toString();
          if (decFromHex !== "NaN" && decFromHex !== input_value) {
            person = await fetchPerson(decFromHex);
          }
        }
      }

      if (!person) {
        return res.status(404).json({ error: 'Cadastro não localizado na portaria (Situator).' });
      }
      documentToSearch = person.Document;
      student_name = person.Name;
      situator_id = person.Id;
    }

    // Passo 3: Lyceum
    const lyceumData = await getLyceumStudent(documentToSearch);

    let course_name = null;
    let lyceum_validated = false;
    let base64Photo = null;

    if (lyceumData && lyceumData.data) {
      lyceum_validated = true;
      student_name = lyceumData.data.nome_compl || student_name;

      const nCurso = lyceumData.data.nome_curso || '';
      const nSerie = lyceumData.data.nome_serie ? ` - ${lyceumData.data.nome_serie}` : '';
      course_name = `${nCurso}${nSerie}`.trim() || null;

      // Passo 4: Foto
      if (lyceumData.data.pessoa) {
        base64Photo = await getLyceumPhoto(lyceumData.data.pessoa);
      }
    } else if (input_type === 'MANUAL' || input_type === 'FACIAL') {
      // Se for manual/facial e o Lyceum falhar, rejeitamos pois não há Situator como Fallback
      return res.status(404).json({ error: 'Matrícula não encontrada no Lyceum. Impossível validar entrada.' });
    }
    // Verificar se a presença já foi registrada nesta aula
    const checkQuery = `SELECT id, exit_at FROM attendances WHERE class_id = $1 AND student_document = $2 LIMIT 1`;
    const checkResult = await pool.query(checkQuery, [classId, documentToSearch]);

    if (checkResult.rows.length > 0) {
      const existing = checkResult.rows[0];
      if (existing.exit_at) {
        return res.status(409).json({ error: 'Opa! Esta pessoa já registrou entrada e saída nesta aula.' });
      } else {
        // Registrar Saída
        const updateQuery = `UPDATE attendances SET exit_at = CURRENT_TIMESTAMP WHERE id = $1 RETURNING *`;
        const updatedResult = await pool.query(updateQuery, [existing.id]);
        return res.status(200).json({
          message: 'Saída registrada.',
          attendance: updatedResult.rows[0],
          is_exit: true
        });
      }
    }

    // Inserir banco de dados (Entrada)
    const insertQuery = `
      INSERT INTO attendances 
      (class_id, input_type, student_document, student_name, course_name, situator_id, lyceum_validated, student_photo) 
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *
    `;
    const values = [
      classId, input_type, documentToSearch, student_name, course_name, situator_id, lyceum_validated, base64Photo
    ];

    const result = await pool.query(insertQuery, values);

    res.status(201).json({
      message: 'Entrada registrada.',
      attendance: result.rows[0],
      is_exit: false
    });

  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

const autoMigrate = async () => {
  try {
    await pool.query(`ALTER TABLE classes ADD COLUMN IF NOT EXISTS min_permanence_minutes INTEGER DEFAULT 60;`);
    await pool.query(`ALTER TABLE attendances ADD COLUMN IF NOT EXISTS exit_at TIMESTAMP;`);
    console.log("Auto-migration successful.");
  } catch (err) {
    console.error("Auto-migration failed:", err.message);
  }
};

autoMigrate().then(() => {
  app.listen(port, () => {
    console.log(`Backend rodando na porta ${port}`);
  });
});
