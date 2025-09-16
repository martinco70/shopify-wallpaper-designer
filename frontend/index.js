import React, { useRef, useState } from 'react';
import ReactDOM from 'react-dom';

const BACKEND_URL = (() => {
  if (typeof window !== 'undefined') {
    const override = window.WALLPAPER_BACKEND || new URLSearchParams(window.location.search).get('backend');
    if (override) return String(override);
    return window.location.origin;
  }
  return 'http://localhost:3001';
})();

function App() {
  const [selectedFile, setSelectedFile] = useState(null);
  const [message, setMessage] = useState('');
  const fileInputRef = useRef(null);

  const handleFileChange = (e) => {
    setSelectedFile(e.target.files[0]);
  };

  const handleUpload = async () => {
    if (!selectedFile) {
      setMessage('Bitte wähle eine Datei aus.');
      return;
    }
    const formData = new FormData();
    formData.append('wallpaper', selectedFile);
    try {
      const response = await fetch(`${BACKEND_URL}/upload`, { method: 'POST', body: formData });
      const ct = String(response.headers.get('content-type') || '').toLowerCase();
      const data = ct.includes('application/json') ? await response.json() : { error: (await response.text()).slice(0, 300) };
      if (!response.ok) throw new Error(data?.error || data?.message || 'Upload fehlgeschlagen');
      setMessage(data.message || 'Upload erfolgreich!');
    } catch (error) {
      setMessage('Fehler beim Upload.');
    }
  };

  const onDrop = (e) => {
    e.preventDefault();
    e.stopPropagation();
    const f = e.dataTransfer?.files?.[0];
    if (f) setSelectedFile(f);
  };

  const onDragOver = (e) => {
    e.preventDefault();
    e.stopPropagation();
  };

  const openPicker = () => fileInputRef.current?.click();

  return (
    <div style={{ padding: 20 }}>
      <h1>Wallpaper hochladen</h1>
      <div
        onClick={openPicker}
        onDrop={onDrop}
        onDragOver={onDragOver}
        style={{
          border: '2px dashed #bbb',
          borderRadius: 8,
          padding: 24,
          textAlign: 'center',
          cursor: 'pointer',
          background: '#fafafa'
        }}
        title="Datei hierher ziehen oder klicken"
      >
        {selectedFile ? (
          <div>
            Ausgewählt: {selectedFile.name}
          </div>
        ) : (
          <div>
            Datei hierher ziehen oder klicken, um auszuwählen
          </div>
        )}
      </div>
      {/* Hidden input keeps functionality without showing the system button */}
      <input
        ref={fileInputRef}
        type="file"
        style={{ display: 'none' }}
        onChange={handleFileChange}
        accept=".jpg,.jpeg,.tif,.tiff,.svg,.eps,.pdf,image/jpeg,image/tiff,application/pdf,image/svg+xml,application/postscript,application/eps,application/x-eps"
      />
      <button onClick={handleUpload} style={{ marginTop: 12 }} disabled={!selectedFile}>Hochladen</button>
      <div style={{ marginTop: 20 }}>{message}</div>
    </div>
  );
}

ReactDOM.render(<App />, document.getElementById('root'));
