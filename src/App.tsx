import { Route, Routes } from 'react-router-dom';
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
    return <Login />;
  }

  return (
    <Routes>
      <Route path="*" element={<Layout />} />
    </Routes>
  );
}