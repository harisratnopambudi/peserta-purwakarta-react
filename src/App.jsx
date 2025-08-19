import React, { useMemo, useState } from 'react';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import dataFull from './label_data_clean.json';

function downloadCSV(rows, filename = 'peserta_terfilter.csv') {
  if (!rows || rows.length === 0) return;
  const headers = Object.keys(rows[0]);
  const csv = [headers.join(',')].concat(
    rows.map((row) => headers.map((h) => {
      const val = row[h] ?? '';
      const cell = String(val).replaceAll('"', '""');
      return '"' + cell + '"';
    }).join(','))
  ).join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.setAttribute('download', filename);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

function toTitleCaseSmart(input) {
  if (!input || typeof input !== 'string') return input;
  const lower = input.toLowerCase();
  const words = lower.split(/(\s+)/); // keep spaces
  const cap = words.map((chunk) => {
    if (/^\s+$/.test(chunk)) return chunk;
    // Handle hyphenated words: e.g., al-muhajirin
    return chunk.split('-').map((part) => {
      if (!part) return part;
      return part.charAt(0).toUpperCase() + part.slice(1);
    }).join('-');
  }).join('');

  // Uppercase common acronyms
  let out = cap
    .replace(/\bSd\b/g, 'SD')
    .replace(/\bSds\b/g, 'SDS')
    .replace(/\bSdi\b/g, 'SDI')
    .replace(/\bSdit\b/g, 'SDIT')
    .replace(/\bSmp\b/g, 'SMP')
    .replace(/\bSmps\b/g, 'SMPS')
    .replace(/\bSmpn\b/g, 'SMPN')
    .replace(/\bMtsn\b/g, 'MTSN')
    .replace(/\bUpi\b/g, 'UPI')
    .replace(/\bQlP\b/g, 'QLP')
    .replace(/\bUin\b/g, 'UIN');

  // Khusus: gabungkan Al + (spasi|-) + Muhajirin -> AlMuhajirin
  out = out.replace(/\bAl[- ]?Muhajirin\b/gi, 'AlMuhajirin');
  return out;
}

function normalizeSchoolName(name) {
  let out = toTitleCaseSmart(name);
  // Standarkan khusus AlMuhajirin: (SD|SDS) [Plus]? <angka> (Al)?Muhajirin [, teks apa pun] -> "SDS Plus <angka> AlMuhajirin"
  const alMuhajirinPattern = /^(SD|SDS)(?:\s+Plus)?\s+(\d+)\s+(?:Al\s*[- ]*)?Muhajirin\b.*$/i;
  const m = out.match(alMuhajirinPattern);
  if (m) {
    const num = m[2];
    return `SDS Plus ${num} AlMuhajirin`;
  }
  return out;
}

function normalizeStudentName(name) {
  return toTitleCaseSmart(name);
}

export default function App() {
  const rawData = useMemo(() => dataFull.map((r) => {
    const o = { ...r };
    for (const k of Object.keys(o)) {
      if (typeof o[k] === 'string') o[k] = o[k].trim();
    }
    if (typeof o['Nama Lengkap Siswa/i'] === 'string') {
      o['Nama Lengkap Siswa/i'] = normalizeStudentName(o['Nama Lengkap Siswa/i']);
    }
    if (typeof o['Sekolah Asal Siswa/i'] === 'string') {
      o['Sekolah Asal Siswa/i'] = normalizeSchoolName(o['Sekolah Asal Siswa/i']);
    }
    return o;
  }), []);

  const [level, setLevel] = useState('');
  const [mapel, setMapel] = useState('');
  const [q, setQ] = useState('');
  const [ruang, setRuang] = useState('');

  const allLevels = useMemo(() => {
    const s = new Set();
    for (const r of rawData) if (r['Level']) s.add(r['Level']);
    return Array.from(s).sort();
  }, [rawData]);

  const filtered = useMemo(() => {
    const qLower = q.trim().toLowerCase();
    const results = [];
    for (const r of rawData) {
      const levelOk = !level || String(r['Level']).trim() === level;
      if (!levelOk) continue;
      const bidangRaw = String(r['Bidang Kompetisi'] ?? '').trim();
      const teksGabung = [
        r['Nama Lengkap Siswa/i'],
        r['Sekolah Asal Siswa/i'],
        r['Level'],
        bidangRaw,
      ].map((x) => String(x ?? '').toLowerCase()).join(' ');
      const searchOk = !qLower || teksGabung.includes(qLower);
      if (!searchOk) continue;

      const isKeduanya = bidangRaw.startsWith('Mengikuti keduanya');

      if (isKeduanya) {
        if (mapel === 'Matematika') {
          results.push({ ...r, 'Bidang Kompetisi': 'Matematika' });
        } else if (mapel === 'Sains') {
          results.push({ ...r, 'Bidang Kompetisi': 'Sains' });
        } else {
          results.push({ ...r, 'Bidang Kompetisi': 'Matematika' });
          results.push({ ...r, 'Bidang Kompetisi': 'Sains' });
        }
      } else {
        if (!mapel || mapel === bidangRaw) {
          results.push(r);
        }
      }
    }
    return results;
  }, [rawData, level, mapel, q]);

  const filteredWithRoom = useMemo(() => {
    if (filtered.length === 0) return [];

    // Group by subject (Matematika/Sains) and level for room assignment
    const groupKey = (subject, levelKey) => `${subject}|${levelKey}`;
    const groups = new Map();
    filtered.forEach((rec) => {
      const subject = String(rec['Bidang Kompetisi'] ?? '').trim();
      const levelKey = String(rec['Level'] ?? '').trim();
      const key = groupKey(subject, levelKey);
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(rec);
    });

    const getRoomsFor = (subject, levelKey) => {
      if (subject === 'Matematika') {
        switch (levelKey) {
          case 'Level 1':
            return ['Ruang 1 Mekkah', 'Ruang 2 Jeddah'];
          case 'Level 2':
            return ['Ruang 3 Riyadh', 'Ruang 4 Muskat'];
          case 'Level 3':
            return ['Ruang 5 Abudhabi', 'Ruang 6 Yaman'];
          case 'Level 4':
          case 'Level 5':
            return ["Ruang 7 Sana'a"];
          default:
            return [];
        }
      }
      if (subject === 'Sains') {
        switch (levelKey) {
          case 'Level 1':
            return ['Ruang 4 Muskat'];
          case 'Level 2':
            return ['Ruang 5 Abudhabi'];
          case 'Level 3':
            return ['Ruang 6 Yaman', "Ruang 7 Sana'a"];
          case 'Level 4':
            return ['Ruang 8 Madinah'];
          default:
            return [];
        }
      }
      return [];
    };

    // Precompute assignments per subject-level
    const assignmentsPerGroup = new Map();
    for (const [key, recs] of groups.entries()) {
      const [subject, levelKey] = key.split('|');
      const rooms = getRoomsFor(subject, levelKey);
      const assignments = new Map();
      if (rooms.length === 1) {
        recs.forEach((_, idx) => assignments.set(idx, rooms[0]));
      } else if (rooms.length === 2) {
        const half = Math.ceil(recs.length / 2);
        recs.forEach((_, idx) => assignments.set(idx, idx < half ? rooms[0] : rooms[1]));
      }
      assignmentsPerGroup.set(key, assignments);
    }

    // Build result preserving order
    const indexTrackerPerGroup = new Map();
    const result = filtered.map((rec) => {
      const subject = String(rec['Bidang Kompetisi'] ?? '').trim();
      const levelKey = String(rec['Level'] ?? '').trim();
      const key = groupKey(subject, levelKey);
      const nextIdx = indexTrackerPerGroup.get(key) ?? 0;
      const ruang = assignmentsPerGroup.get(key)?.get(nextIdx) ?? '';
      indexTrackerPerGroup.set(key, nextIdx + 1);
      return { ...rec, Ruang: ruang };
    });

    return result;
  }, [filtered]);

  const allRooms = useMemo(() => {
    const s = new Set();
    for (const r of filteredWithRoom) {
      const name = String(r['Ruang'] ?? '').trim();
      if (name) s.add(name);
    }
    return Array.from(s).sort();
  }, [filteredWithRoom]);

  const filteredFinal = useMemo(() => {
    if (!ruang) return filteredWithRoom;
    return filteredWithRoom.filter((r) => String(r['Ruang'] ?? '') === ruang);
  }, [filteredWithRoom, ruang]);

  const total = rawData.length;
  const totalMat = rawData.filter((r) => String(r['Bidang Kompetisi'] ?? '').trim() === 'Matematika').length;
  const totalSains = rawData.filter((r) => String(r['Bidang Kompetisi'] ?? '').trim() === 'Sains').length;
  const totalKeduanya = rawData.filter((r) => String(r['Bidang Kompetisi'] ?? '').startsWith('Mengikuti keduanya')).length;

  return (
    <div style={{fontFamily:'ui-sans-serif, system-ui', background:'#f9fafb', minHeight:'100vh', padding:'24px'}}>
      <div style={{maxWidth:'1100px', margin:'0 auto'}}>
        <div style={{display:'flex', justifyContent:'space-between', gap:'16px', alignItems:'flex-start'}}>
          <div>
            <h1 style={{fontSize:'22px', fontWeight:700}}>Filter Peserta Purwakarta</h1>
            <p style={{fontSize:'12px', color:'#4b5563'}}>Sumber data: Sheet <code>Label</code> (Excel).</p>
          </div>
          <div style={{display:'flex', gap:'8px'}}>
            <button onClick={() => {
              const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: [330, 210] });
              const pageWidth = doc.internal.pageSize.getWidth();
              const buildTitle = () => {
                const parts = ['Daftar Peserta'];
                if (mapel) parts.push(mapel);
                if (level) parts.push(level);
                return parts.join(' ');
              };
              const mainTitle = buildTitle();
              const subTitle = ruang ? String(ruang) : '';

              // Main title centered
              doc.setFont('helvetica', 'bold');
              doc.setFontSize(16);
              const mainWidth = doc.getTextWidth(mainTitle);
              doc.text(mainTitle, (pageWidth - mainWidth) / 2, 14);

              // Optional subtitle (room) centered
              let startY = 18;
              if (subTitle) {
                doc.setFont('helvetica', 'normal');
                doc.setFontSize(12);
                const subWidth = doc.getTextWidth(subTitle);
                doc.text(subTitle, (pageWidth - subWidth) / 2, 22);
                startY = 26;
              }

              const headers = ['No','Nama Lengkap Siswa/i','Sekolah Asal Siswa/i','Level','Bidang Kompetisi','Ruang','Pilihan Bahasa untuk soal'];
              const body = filteredFinal.map((r, idx) => [
                idx + 1,
                String(r['Nama Lengkap Siswa/i'] ?? ''),
                String(r['Sekolah Asal Siswa/i'] ?? ''),
                String(r['Level'] ?? ''),
                String(r['Bidang Kompetisi'] ?? ''),
                String(r['Ruang'] ?? ''),
                String(r['Pilihan Bahasa untuk soal'] ?? ''),
              ]);
              autoTable(doc, {
                head: [headers],
                body,
                startY,
                styles: { fontSize: 9, cellPadding: 2 },
                headStyles: { fillColor: [243,244,246], textColor: [55,65,81] },
                columnStyles: {
                  0: { cellWidth: 12 },
                  1: { cellWidth: 60 },
                  2: { cellWidth: 60 },
                  3: { cellWidth: 22 },
                  4: { cellWidth: 40 },
                  5: { cellWidth: 30 },
                  6: { cellWidth: 45 },
                },
              });
              doc.save('peserta_terfilter.pdf');
            }}>Unduh PDF</button>
          </div>
        </div>
        <div style={{display:'grid', gridTemplateColumns:'repeat(4, minmax(0, 1fr))', gap:'12px', marginTop:'16px'}}>
          <Stat label="Total Peserta" value={total} />
          <Stat label="Hanya Matematika" value={totalMat} />
          <Stat label="Hanya Sains" value={totalSains} />
          <Stat label="Mengikuti Keduanya" value={totalKeduanya} />
        </div>
        <div style={{background:'#fff', padding:'16px', borderRadius:'14px', boxShadow:'0 1px 2px rgba(0,0,0,0.06)', marginTop:'16px'}}>
          <div style={{display:'grid', gridTemplateColumns:'repeat(5, minmax(0, 1fr))', gap:'12px'}}>
            <div>
              <label style={{fontSize:'12px', color:'#4b5563'}}>Level</label>
              <select value={level} onChange={e=>setLevel(e.target.value)} style={{width:'100%', padding:'8px', borderRadius:'10px', border:'1px solid #e5e7eb'}}>
                <option value="">Semua Level</option>
                {allLevels.map((lv)=> <option key={lv} value={lv}>{lv}</option>)}
              </select>
            </div>
            <div>
              <label style={{fontSize:'12px', color:'#4b5563'}}>Mapel</label>
              <select value={mapel} onChange={e=>setMapel(e.target.value)} style={{width:'100%', padding:'8px', borderRadius:'10px', border:'1px solid #e5e7eb'}}>
                <option value="">Semua</option>
                <option value="Matematika">Matematika</option>
                <option value="Sains">Sains</option>
              </select>
            </div>
            <div>
              <label style={{fontSize:'12px', color:'#4b5563'}}>Ruang</label>
              <select value={ruang} onChange={e=>setRuang(e.target.value)} style={{width:'100%', padding:'8px', borderRadius:'10px', border:'1px solid #e5e7eb'}}>
                <option value="">Semua Ruang</option>
                {allRooms.map((r)=> <option key={r} value={r}>{r}</option>)}
              </select>
            </div>
            <div style={{gridColumn:'span 2 / span 2'}}>
              <label style={{fontSize:'12px', color:'#4b5563'}}>Cari (nama/sekolah)</label>
              <input value={q} onChange={e=>setQ(e.target.value)} placeholder="Ketik untuk mencari..." style={{width:'100%', padding:'8px', borderRadius:'10px', border:'1px solid #e5e7eb'}} />
            </div>
          </div>
          <p style={{fontSize:'12px', color:'#4b5563', marginTop:'6px'}}><b>Catatan:</b> Gunakan filter <i>Level</i>, <i>Mapel</i>, dan <i>Ruang</i> di atas. Penomoran tabel dimulai dari 1 sesuai hasil filter, dan pembagian ruang mengikuti aturan per level.</p>
        </div>
        <div style={{background:'#fff', borderRadius:'14px', boxShadow:'0 1px 2px rgba(0,0,0,0.06)', marginTop:'16px', overflow:'hidden'}}>
          <div style={{overflowX:'auto'}}>
            <table style={{minWidth:'100%', fontSize:'14px', borderCollapse:'collapse'}}>
              <thead style={{background:'#f3f4f6', textAlign:'left'}}>
                <tr>
                  <Th>No</Th>
                  <Th>Nama Lengkap Siswa/i</Th>
                  <Th>Sekolah Asal Siswa/i</Th>
                  <Th>Level</Th>
                  <Th>Bidang Kompetisi</Th>
                  <Th>Ruang</Th>
                  <Th>Pilihan Bahasa untuk soal</Th>
                </tr>
              </thead>
              <tbody>
                {filteredFinal.map((r, idx) => (
                  <tr key={`${r['No']}-${idx}`} style={{background: idx % 2 ? '#f9fafb' : 'transparent'}}>
                    <Td>{idx + 1}</Td>
                    <Td style={{fontWeight:600}}>{r['Nama Lengkap Siswa/i']}</Td>
                    <Td>{r['Sekolah Asal Siswa/i']}</Td>
                    <Td>{r['Level']}</Td>
                    <Td>{r['Bidang Kompetisi']}</Td>
                    <Td>{r['Ruang']}</Td>
                    <Td>{r['Pilihan Bahasa untuk soal']}</Td>
                  </tr>
                ))}
                {filteredFinal.length === 0 && (
                  <tr>
                    <td colSpan={7} style={{textAlign:'center', padding:'24px', color:'#6b7280'}}>Tidak ada data yang cocok.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          <div style={{padding:'12px', fontSize:'13px', color:'#4b5563', borderTop:'1px solid #e5e7eb'}}>Menampilkan {filteredFinal.length} dari {total} baris.</div>
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value }) {
  return (
    <div style={{background:'#fff', padding:'16px', borderRadius:'14px', boxShadow:'0 1px 2px rgba(0,0,0,0.06)'}}>
      <div style={{fontSize:'12px', color:'#6b7280'}}>{label}</div>
      <div style={{fontSize:'22px', fontWeight:600}}>{value}</div>
    </div>
  );
}

function Th({ children }) {
  return (
    <th style={{padding:'8px 12px', fontSize:'12px', fontWeight:600, color:'#374151', whiteSpace:'nowrap'}}>{children}</th>
  );
}

function Td({ children, className = '' }) {
  return (
    <td style={{padding:'8px 12px', whiteSpace:'nowrap'}} className={className}>{children}</td>
  );
}
