import React, { useState, useEffect, useRef } from 'react';
import { BrowserRouter as Router, Routes, Route, useNavigate } from 'react-router-dom';
import axios from 'axios';
import { Users, UserCheck, XCircle, AlertTriangle, Monitor, Play, RotateCcw, UserPlus, Trash2, Download, LogOut } from 'lucide-react';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import html2canvas from 'html2canvas';
import ReactECharts from 'echarts-for-react';

const API_URL = '/api';

const api = axios.create({ baseURL: API_URL });

function shortName(fullName) {
  if (!fullName) return '';
  const parts = fullName.trim().split(' ');
  if (parts.length === 1) return parts[0];
  return `${parts[0]} ${parts[parts.length - 1]}`;
}

function Home({ setActiveSession }) {
  const [professor, setProfessor] = useState('');
  const [className, setClassName] = useState('');
  const [recentSessions, setRecentSessions] = useState([]);
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();

  useEffect(() => {
    fetchSessions();
  }, []);

  const fetchSessions = async () => {
    try {
      const res = await api.get('/sessions');
      setRecentSessions(res.data);
    } catch (err) {
      console.error(err);
    }
  };

  const handleStart = async (e) => {
    e.preventDefault();
    setLoading(true);
    try {
      const res = await api.post('/sessions', { professor_name: professor, class_name: className });
      const session = res.data;
      setActiveSession(session);
      localStorage.setItem('presence_active_session', JSON.stringify(session));
      navigate('/coleta');
    } catch (err) {
      alert('Erro ao iniciar sessão');
    } finally {
      setLoading(false);
    }
  };

  const handleResume = async (session) => {
    try {
      const res = await api.post(`/sessions/${session.id}/resume`);
      setActiveSession(res.data);
      localStorage.setItem('presence_active_session', JSON.stringify(res.data));
      navigate('/coleta');
    } catch (err) {
      alert('Erro ao retomar sessão');
    }
  };

  return (
    <div className="card" style={{ maxWidth: '600px', margin: '0 auto' }}>
      <h1>Setup da Aula</h1>
      <form onSubmit={handleStart}>
        <div className="input-group">
          <label className="input-label">Nome do Professor</label>
          <input required className="input-field" value={professor} onChange={e => setProfessor(e.target.value)} placeholder="Ex: Marcos" />
        </div>
        <div className="input-group">
          <label className="input-label">Nome da Disciplina / Aula</label>
          <input required className="input-field" value={className} onChange={e => setClassName(e.target.value)} placeholder="Ex: Anatomia" />
        </div>
        <button type="submit" disabled={loading} className="btn btn-primary" style={{ width: '100%' }}>
          <Play size={20} /> Iniciar Nova Aula
        </button>
      </form>

      {recentSessions.length > 0 && (
        <div style={{ marginTop: '2rem' }}>
          <h2>Sessões Recentes</h2>
          <div className="attendance-list">
            {recentSessions.map(s => (
              <div key={s.id} className={`attendance-item ${s.status === 'ACTIVE' ? 'item-success' : ''}`}>
                <div>
                  <div style={{ fontWeight: 600 }}>{s.class_name}</div>
                  <div style={{ fontSize: '0.875rem', color: 'var(--text-secondary)' }}>{s.professor_name}</div>
                </div>
                <div style={{ display: 'flex', gap: '1rem', alignItems: 'center' }}>
                  <span className={`badge ${s.status === 'ACTIVE' ? 'badge-success' : 'badge-neutral'}`}>{s.status}</span>
                  <button type="button" onClick={() => handleResume(s)} className="btn btn-secondary" style={{ padding: '0.4rem 0.8rem', fontSize: '0.875rem' }}>
                    <RotateCcw size={16} /> Retomar
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function Collection({ activeSession, setActiveSession }) {
  const [attendances, setAttendances] = useState([]);
  const [currentStudent, setCurrentStudent] = useState(null);
  const [manualInput, setManualInput] = useState('');
  const [showManual, setShowManual] = useState(false);
  const [showEndModal, setShowEndModal] = useState(false);
  const [showRemoveModal, setShowRemoveModal] = useState(null);
  const [toastMsg, setToastMsg] = useState(null);
  
  const rfidInputRef = useRef(null);
  const bufferRef = useRef('');
  const navigate = useNavigate();

  useEffect(() => {
    if (!activeSession) {
      navigate('/');
      return;
    }
    fetchAttendances();
    
    // Focus lock for RFID Kiosk mode
    const focusInterval = setInterval(() => {
      // Do not block focus for toast messages so kiosk can keep running
      if (!showManual && !showEndModal && rfidInputRef.current) {
        rfidInputRef.current.focus();
      }
    }, 1000);
    
    return () => clearInterval(focusInterval);
  }, [activeSession, showManual, showEndModal, showRemoveModal]);

  // Auto-hide toast after 4 seconds
  useEffect(() => {
    if (toastMsg) {
      const timer = setTimeout(() => setToastMsg(null), 4000);
      return () => clearTimeout(timer);
    }
  }, [toastMsg]);

  // Auto-hide Student Photo Hero after 20 seconds of inactivity
  useEffect(() => {
    let timer;
    if (currentStudent && attendances.length > 0) {
      timer = setTimeout(() => {
        setCurrentStudent(null);
      }, 20000);
    }
    return () => clearTimeout(timer);
  }, [currentStudent, attendances]);

  const fetchAttendances = async () => {
    if (!activeSession) return;
    try {
      const res = await api.get(`/sessions/${activeSession.id}/attendances`);
      setAttendances(res.data);
      if (res.data.length > 0 && !currentStudent) {
        setCurrentStudent(res.data[0]);
      }
    } catch (err) {
      console.error(err);
    }
  };

  const registerAttendance = async (value, type) => {
    if (!value) return;
    try {
      const res = await api.post('/attendance', {
        classId: activeSession.id,
        input_value: value,
        input_type: type
      });
      const newAttendance = res.data.attendance;
      setCurrentStudent(newAttendance);
      setAttendances(prev => [newAttendance, ...prev]);
    } catch (err) {
      setToastMsg(err.response?.data?.error || 'Erro ao registrar presença');
    }
  };

  const handleRFIDKeyDown = (e) => {
    if (e.key === 'Enter') {
      const value = bufferRef.current;
      bufferRef.current = '';
      if (value) registerAttendance(value, 'RFID');
    } else {
      // Basic character filter
      if (e.key.length === 1) {
        bufferRef.current += e.key;
      }
    }
  };

  const handeManualSubmit = (e) => {
    e.preventDefault();
    registerAttendance(manualInput, 'MANUAL');
    setManualInput('');
    setShowManual(false);
  };

  const handleEndClass = async () => {
    try {
      await api.post(`/sessions/${activeSession.id}/end`);
      localStorage.removeItem('presence_active_session');
      setActiveSession(null);
      setShowEndModal(false);
      navigate('/');
    } catch (err) {
      setToastMsg('Erro ao encerrar a aula');
    }
  };

  const handleSair = () => {
    setActiveSession(null);
    localStorage.removeItem('presence_active_session');
    navigate('/');
  };

  const handleRemoveAttendance = async () => {
    if (!showRemoveModal) return;
    try {
      await api.delete(`/attendances/${showRemoveModal.id}`);
      setAttendances(prev => prev.filter(a => a.id !== showRemoveModal.id));
      if (currentStudent && currentStudent.id === showRemoveModal.id) {
        setCurrentStudent(null);
      }
      setShowRemoveModal(null);
      setToastMsg('Registro removido com sucesso');
    } catch (err) {
      setToastMsg('Erro ao remover registro');
    }
  };

  if (!activeSession) return null;

  return (
    <div style={{ maxWidth: '800px', margin: '0 auto' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '2rem' }}>
        <div>
          <h2 style={{ marginBottom: 0 }}>{activeSession.class_name}</h2>
          <div style={{ color: 'var(--text-secondary)' }}>Prof. {activeSession.professor_name}</div>
        </div>
        <div style={{ display: 'flex', gap: '0.5rem' }}>
          <button onClick={handleSair} className="btn btn-secondary">
            <LogOut size={16} style={{ marginRight: '0.5rem' }} /> Sair
          </button>
          <button onClick={() => setShowEndModal(true)} className="btn btn-danger">Encerrar Aula</button>
        </div>
      </div>

      <input 
        ref={rfidInputRef}
        className="hidden-rfid"
        onKeyDown={handleRFIDKeyDown}
        autoFocus
      />

      {currentStudent ? (
        <div className="hero-display">
          <div className="hero-photo-placeholder">
            {currentStudent.student_photo ? (
              <img src={`data:image/jpeg;base64,${currentStudent.student_photo}`} alt="Foto do Aluno" className="hero-photo" />
            ) : (
              <UserCheck size={48} color="var(--text-secondary)" />
            )}
          </div>
          <div className="hero-details">
            <div className="badge badge-success" style={{ display: 'inline-block', marginBottom: '0.5rem' }}>Identificação Confirmada</div>
            <div className="hero-name">{shortName(currentStudent.student_name)}</div>
            {currentStudent.course_name && <div className="hero-course">{currentStudent.course_name}</div>}
            
            <div style={{ marginTop: '1rem', display: 'flex', gap: '0.5rem' }}>
              <span className="badge badge-neutral">via {currentStudent.input_type}</span>
              {currentStudent.lyceum_validated ? (
                <span className="badge badge-success">Validado Lyceum</span>
              ) : (
                <span className="badge badge-warning">Fallback Situator (Não no Lyceum)</span>
              )}
            </div>
          </div>
        </div>
      ) : (
        <div className="hero-display" style={{ justifyContent: 'center', textAlign: 'center' }}>
          <div style={{ color: 'var(--text-secondary)' }}>
            <Monitor size={48} style={{ margin: '0 auto 1rem' }} />
            <h2 style={{ color: 'var(--text-primary)' }}>Aguardando</h2>
            <p>Passe a carteirinha no leitor para registrar a presença.</p>
          </div>
        </div>
      )}

      <div style={{ marginBottom: '1.5rem', display: 'flex', justifyContent: 'flex-end' }}>
        <button onClick={() => setShowManual(!showManual)} className="btn btn-secondary">
          <UserPlus size={18} /> {showManual ? 'Ocultar Entrada Manual' : 'Digitar matrícula'}
        </button>
      </div>

      {showManual && (
        <div className="card" style={{ marginBottom: '2rem' }}>
          <form onSubmit={handeManualSubmit} style={{ display: 'flex', gap: '1rem' }}>
            <input 
              required 
              className="input-field" 
              placeholder="Digite a matrícula do aluno..." 
              value={manualInput}
              onChange={e => setManualInput(e.target.value)}
              style={{ flex: 1 }}
              autoFocus
            />
            <button type="submit" className="btn btn-primary">Registrar</button>
          </form>
        </div>
      )}

      <h2>Últimos Registros</h2>
      <div className="attendance-list">
        {attendances.map(att => (
          <div 
            key={att.id} 
            className={`attendance-item ${att.lyceum_validated ? 'item-success' : 'item-warning'}`}
            onClick={() => setShowRemoveModal(att)}
            style={{ cursor: 'pointer' }}
          >
            <div>
              <div style={{ fontWeight: 600 }}>{shortName(att.student_name)}</div>
              <div style={{ fontSize: '0.875rem', color: 'var(--text-secondary)' }}>
                {new Date(att.created_at).toLocaleTimeString()} • {att.course_name || 'Curso Misto'}
              </div>
            </div>
            <div style={{ textAlign: 'right' }}>
              <div className="badge badge-neutral">{att.input_type}</div>
              {!att.lyceum_validated && (
                <div style={{ fontSize: '0.75rem', color: 'var(--warning)', marginTop: '0.25rem', display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
                  <AlertTriangle size={12} /> Dados Incompletos
                </div>
              )}
            </div>
          </div>
        ))}
        {attendances.length === 0 && (
          <div style={{ textAlign: 'center', padding: '2rem', color: 'var(--text-secondary)' }}>
            Nenhum registro até agora.
          </div>
        )}
      </div>

      {showEndModal && (
        <div className="modal-overlay">
          <div className="modal-content">
            <h2>Encerrar Aula?</h2>
            <p style={{ color: 'var(--text-secondary)', marginBottom: '1.5rem' }}>Ao encerrar esta aula, ela não poderá receber novas presenças. Deseja confirmar o encerramento da sessão ativa?</p>
            <div className="modal-actions">
              <button onClick={() => setShowEndModal(false)} className="btn btn-secondary">Cancelar</button>
              <button onClick={handleEndClass} className="btn btn-danger">Confirmar Encerramento</button>
            </div>
          </div>
        </div>
      )}

      {showRemoveModal && (
        <div className="modal-overlay">
          <div className="modal-content">
            <h2>Remover Registro</h2>
            <div style={{ marginBottom: '1.5rem', display: 'flex', alignItems: 'center', gap: '1rem', background: 'var(--surface)', padding: '1rem', borderRadius: '8px' }}>
              <div className="hero-photo-placeholder" style={{ width: '60px', height: '60px', borderRadius: '8px', overflow: 'hidden' }}>
              {showRemoveModal.student_photo ? (
                <img src={`data:image/jpeg;base64,${showRemoveModal.student_photo}`} alt="Foto" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
              ) : (
                <UserCheck size={32} color="var(--text-secondary)" />
              )}
              </div>
              <div>
                <div style={{ fontWeight: 'bold' }}>{showRemoveModal.student_name}</div>
                <div style={{ fontSize: '0.875rem', color: 'var(--text-secondary)' }}>{showRemoveModal.student_document}</div>
              </div>
            </div>
            <p style={{ color: 'var(--text-secondary)', marginBottom: '1.5rem' }}>Tem certeza que deseja remover a presença deste aluno?</p>
            <div className="modal-actions">
              <button onClick={() => setShowRemoveModal(null)} className="btn btn-secondary">Cancelar</button>
              <button onClick={handleRemoveAttendance} className="btn btn-danger" style={{ background: '#ff3b30' }}>
                <Trash2 size={16} style={{marginRight:'4px'}}/> Remover
              </button>
            </div>
          </div>
        </div>
      )}

      {toastMsg && (
        <div style={{
          position: 'fixed', top: '2rem', left: 0, width: '100%',
          display: 'flex', justifyContent: 'center', zIndex: 100, pointerEvents: 'none'
        }}>
          <div style={{
            background: 'rgba(255, 69, 58, 0.95)', color: 'white', padding: '1rem 2rem',
            borderRadius: '999px', backdropFilter: 'blur(20px)', WebkitBackdropFilter: 'blur(20px)', 
            boxShadow: '0 8px 32px rgba(255, 69, 58, 0.4)',
            display: 'flex', alignItems: 'center', gap: '0.75rem',
            animation: 'fadeIn 0.3s cubic-bezier(0.2, 0.8, 0.2, 1)', pointerEvents: 'auto'
          }}>
            <AlertTriangle size={24} />
            <span style={{ fontWeight: 600, fontSize: '1.05rem' }}>{toastMsg}</span>
          </div>
        </div>
      )}
    </div>
  );
}

function Reports({ activeSession }) {
  const [sessions, setSessions] = useState([]);
  const [selectedSessionId, setSelectedSessionId] = useState('');
  const [attendances, setAttendances] = useState([]);
  const [includeCharts, setIncludeCharts] = useState(false);

  useEffect(() => {
    const fetchDropdown = async () => {
      try {
        const res = await api.get('/sessions');
        setSessions(res.data);
        if (activeSession) {
          setSelectedSessionId(activeSession.id);
        } else if (res.data.length > 0) {
          setSelectedSessionId(res.data[0].id);
        }
      } catch (err) {
        console.error(err);
      }
    };
    fetchDropdown();
  }, [activeSession]);

  useEffect(() => {
    if (!selectedSessionId) return;
    const fetchAtt = async () => {
      try {
        const res = await api.get(`/sessions/${selectedSessionId}/attendances`);
        setAttendances(res.data);
      } catch (err) {
        console.error(err);
      }
    }
    fetchAtt();
  }, [selectedSessionId]);

  const courseData = React.useMemo(() => {
    const counts = {};
    attendances.forEach(att => {
      const course = att.course_name || 'Desconhecido';
      counts[course] = (counts[course] || 0) + 1;
    });
    return Object.entries(counts)
      .map(([name, value]) => ({ name, value }))
      .sort((a, b) => b.value - a.value);
  }, [attendances]);
  
  const PIE_COLORS = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899', '#06b6d4'];

  const chartOptions = {
    tooltip: { trigger: 'item', formatter: '{b}: {c} aluno(s) ({d}%)' },
    legend: { orient: 'horizontal', bottom: 0, textStyle: { fontSize: 11, color: 'var(--text-secondary)' }, type: 'scroll' },
    color: PIE_COLORS,
    series: [
      {
        name: 'Cursos',
        type: 'pie',
        radius: ['35%', '60%'],
        center: ['50%', '42%'],
        avoidLabelOverlap: false,
        itemStyle: { borderRadius: 8, borderColor: '#fff', borderWidth: 2 },
        label: { show: false, position: 'center' },
        emphasis: { label: { show: true, fontSize: 14, fontWeight: 'bold' } },
        labelLine: { show: false },
        data: courseData
      }
    ]
  };

  const exportPDF = async (mode) => {
    const doc = new jsPDF();
    const session = sessions.find(s => s.id === selectedSessionId);
    
    doc.setFont("helvetica");
    doc.setFontSize(18);
    doc.text(`Relatorio de Frequencia - ${session?.class_name || 'Desconhecida'}`, 14, 22);
    doc.setFontSize(11);
    doc.text(`Professor: ${session?.professor_name || ''}`, 14, 30);
    doc.text(`Data: ${session ? new Date(session.created_at).toLocaleDateString() : ''}`, 14, 36);
    doc.text(`Total de alunos: ${attendances.length}`, 14, 42);
    
    const head = [[]];
    const body = [];
    
    if (mode === 'COMPACT') {
      head[0] = ['Nome', 'Matricula', 'Curso', 'Hora'];
      attendances.forEach(att => {
        body.push([
          att.student_name,
          att.student_document,
          att.course_name || 'N/A',
          new Date(att.created_at).toLocaleTimeString()
        ]);
      });
      autoTable(doc, {
        startY: 48,
        head: head,
        body: body,
      });
    } else {
      head[0] = ['Foto', 'Nome', 'Matricula', 'Curso', 'Tipo', 'Validado', 'Hora'];
      attendances.forEach(att => {
        body.push([
          att.student_photo ? { content: '', image: `data:image/jpeg;base64,${att.student_photo}` } : '',
          att.student_name,
          att.student_document,
          att.course_name || 'N/A',
          att.input_type,
          att.lyceum_validated ? 'Sim' : 'Nao',
          new Date(att.created_at).toLocaleTimeString()
        ]);
      });
      autoTable(doc, {
        startY: 48,
        head: head,
        body: body,
        didDrawCell: (data) => {
          if (data.section === 'body' && data.column.index === 0 && data.cell.raw && data.cell.raw.image) {
            try {
              doc.addImage(data.cell.raw.image, 'JPEG', data.cell.x + 2, data.cell.y + 2, 10, 10);
            } catch (e) {
              console.error(e);
            }
          }
        },
        rowPageBreak: 'avoid',
        styles: { minCellHeight: 14 }
      });
    }

    if (includeCharts && attendances.length > 0) {
      const chartContainer = document.getElementById('course-chart-container');
      if (chartContainer) {
        // Simple workaround for Recharts rendering animations delay if not fully loaded.
        const canvas = await html2canvas(chartContainer, { backgroundColor: '#ffffff', scale: 2 });
        const imgData = canvas.toDataURL('image/png');
        doc.addPage();
        doc.setFontSize(14);
        doc.text("Gráfico de Distribuição por Curso", 14, 22);
        
        const pdfWidth = doc.internal.pageSize.getWidth();
        const finalWidth = pdfWidth - 28;
        const finalHeight = (canvas.height * finalWidth) / canvas.width;
        
        doc.addImage(imgData, 'PNG', 14, 30, finalWidth, finalHeight);
      }
    }

    doc.save(`frequencia-${mode.toLowerCase()}-${session?.class_name || 'relatorio'}.pdf`);
  };

  return (
    <div className="card" style={{ maxWidth: '900px', margin: '0 auto' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
        <h1 style={{ margin: 0 }}>Relatório de Frequência</h1>
        <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.85rem', cursor: 'pointer', marginRight: '0.5rem' }}>
            <input type="checkbox" checked={includeCharts} onChange={e => setIncludeCharts(e.target.checked)} />
            Incluir gráficos no PDF
          </label>
          <button onClick={() => exportPDF('COMPACT')} className="btn btn-secondary" style={{ fontSize: '0.8rem', padding: '0.5rem 0.8rem' }} disabled={attendances.length === 0}>
            <Download size={14} style={{ marginRight: '4px' }} /> Exportar Compacto
          </button>
          <button onClick={() => exportPDF('COMPLETE')} className="btn btn-primary" style={{ fontSize: '0.8rem', padding: '0.5rem 0.8rem' }} disabled={attendances.length === 0}>
            <Download size={14} style={{ marginRight: '4px' }} /> Exportar Completo
          </button>
        </div>
      </div>
      
      <div className="input-group" style={{ maxWidth: '400px', marginBottom: '2rem' }}>
        <label className="input-label">Selecione a Aula</label>
        <select 
          className="input-field" 
          value={selectedSessionId} 
          onChange={e => setSelectedSessionId(e.target.value)}
        >
          {sessions.map(s => (
            <option key={s.id} value={s.id}>{s.class_name} ({s.status}) - {new Date(s.created_at).toLocaleDateString()}</option>
          ))}
        </select>
      </div>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '1.5rem', marginBottom: '2rem' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem', flex: '1 1 250px' }}>
          <div className="card" style={{ padding: '1.5rem', background: 'rgba(255,255,255,0.7)', border: '1px solid rgba(255,255,255,0.9)', flex: 1 }}>
             <h3 style={{ margin: 0, color: 'var(--text-secondary)', fontSize: '1rem', fontWeight: 500 }}>Total de Alunos Presentes</h3>
             <div style={{ fontSize: '3.5rem', fontWeight: 700, color: 'var(--text-primary)', lineHeight: 1 }}>{attendances.length}</div>
          </div>
          <div className="card" style={{ padding: '1.5rem', background: 'rgba(255,255,255,0.7)', border: '1px solid rgba(255,255,255,0.9)', flex: 1 }}>
             <h3 style={{ margin: '0 0 1rem 0', color: 'var(--text-secondary)', fontSize: '1rem', fontWeight: 500 }}>Origem do Registro</h3>
             <div style={{ display: 'flex', width: '100%', height: '18px', borderRadius: '999px', overflow: 'hidden', marginBottom: '0.75rem', background: 'rgba(0,0,0,0.05)' }}>
               <div style={{ width: `${attendances.length ? (attendances.filter(a => a.input_type === 'RFID').length / attendances.length) * 100 : 0}%`, background: '#34c759', transition: 'all 0.5s' }} />
               <div style={{ width: `${attendances.length ? (attendances.filter(a => a.input_type === 'MANUAL').length / attendances.length) * 100 : 0}%`, background: '#ffcc00', transition: 'all 0.5s' }} />
             </div>
             <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.85rem' }}>
               <span style={{ color: '#248a3d', fontWeight: 600 }}>• RFID: {attendances.filter(a => a.input_type === 'RFID').length}</span>
               <span style={{ color: '#b38f00', fontWeight: 600 }}>Manual: {attendances.filter(a => a.input_type === 'MANUAL').length} •</span>
             </div>
          </div>
        </div>
        <div className="card" id="course-chart-container" style={{ padding: '1.5rem', background: 'rgba(255,255,255,0.7)', border: '1px solid rgba(255,255,255,0.9)', flex: '2 1 400px', minHeight: '450px' }}>
           <h3 style={{ margin: '0 0 1rem 0', color: 'var(--text-secondary)', fontSize: '1rem', fontWeight: 500 }}>Distribuição por Curso</h3>
           <div style={{ height: '400px', width: '100%' }}>
             <ReactECharts option={chartOptions} style={{ height: '100%', width: '100%' }} />
           </div>
        </div>
      </div>

      <div className="attendance-list">
        {attendances.map((att, i) => (
          <div key={att.id} className="attendance-item">
            <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
              <div style={{ width: '30px', fontWeight: 'bold', color: 'var(--text-secondary)' }}>#{attendances.length - i}</div>
              <div style={{ width: '40px', height: '40px', borderRadius: '50%', overflow: 'hidden', background: 'var(--surface-dark)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                {att.student_photo ? (
                  <img src={`data:image/jpeg;base64,${att.student_photo}`} alt="Foto" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                ) : (
                  <UserCheck size={20} color="var(--text-secondary)" />
                )}
              </div>
              <div>
                <div style={{ fontWeight: 600 }}>{att.student_name}</div>
                <div style={{ fontSize: '0.875rem', color: 'var(--text-secondary)' }}>
                  {att.student_document} • {att.course_name || 'N/A'}
                </div>
              </div>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
              <div>{new Date(att.created_at).toLocaleTimeString()}</div>
              <span className="badge badge-neutral">{att.input_type}</span>
              {att.lyceum_validated ? (
                <span className="badge badge-success"><UserCheck size={12} style={{ marginRight: 4 }}/> Lyceum</span>
              ) : (
                <span className="badge badge-warning"><AlertTriangle size={12} style={{ marginRight: 4 }}/> Situator Somente</span>
              )}
            </div>
          </div>
        ))}
        {attendances.length === 0 && <div style={{ color: 'var(--text-secondary)' }}>Sem registros.</div>}
      </div>
    </div>
  );
}

function App() {
  const [activeSession, setActiveSession] = useState(null);
  const [currentTab, setCurrentTab] = useState('home'); 

  // Initialize session from LocalStorage (Resilience to F5 / Connection drops)
  useEffect(() => {
    const saved = localStorage.getItem('presence_active_session');
    if (saved) {
      try {
        const session = JSON.parse(saved);
        setActiveSession(session);
        // Do not force route here since we may want to view reports
      } catch (e) {
        localStorage.removeItem('presence_active_session');
      }
    }
  }, []);

  return (
    <Router>
      <div style={{
        background: 'rgba(58, 108, 112, 0.7)', /* 70% opacity base on requested color */
        backdropFilter: 'blur(20px)',
        WebkitBackdropFilter: 'blur(20px)',
        padding: '1rem',
        display: 'flex',
        justifyContent: 'center',
        position: 'sticky',
        top: 0,
        zIndex: 40,
        borderBottom: '1px solid rgba(255, 255, 255, 0.2)'
      }}>
        <img src="https://fmc-campos.com.br/wp-content/uploads/2023/08/white_fmc.webp" alt="FMC Logo" style={{ height: '45px', objectFit: 'contain' }} />
      </div>
      <div className="app-container">
        {!activeSession && (
          <header className="nav-bar">
            <div></div> {/* Espaço vazio para manter o Flexbox */}
            <nav className="nav-links">
              <a href="/" style={{ textDecoration: 'none' }}>
                <button className="active">
                  Setup
                </button>
              </a>
              <a href="/reports" style={{ textDecoration: 'none', marginLeft: '1rem' }}>
                <button>Relatórios</button>
              </a>
            </nav>
          </header>
        )}

        <main>
          <Routes>
            <Route path="/" element={<Home setActiveSession={setActiveSession} />} />
            <Route path="/coleta" element={<Collection activeSession={activeSession} setActiveSession={setActiveSession} />} />
            <Route path="/reports" element={<Reports activeSession={activeSession} />} />
          </Routes>
        </main>
      </div>
    </Router>
  );
}

export default App;
