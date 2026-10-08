import { Navigate, Route, Routes } from 'react-router-dom';
import { useAuth } from './auth/AuthContext';
import Layout from './components/Layout';
import Login from './components/Login';
import Loading from './components/Loading';

export default function App() {
  const { me, loading } = useAuth();

  if (loading) {
    return <Loading />;
  }

  if (!me) {
    return (
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="*" element={<Navigate to="/login" replace />} />
      </Routes>
    );
  }

  return (
    <Routes>
      <Route path="/login" element={<Navigate to="/books" replace />} />
      <Route path="/*" element={<Layout />} />
    </Routes>
  );
}
