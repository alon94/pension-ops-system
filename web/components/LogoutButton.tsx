'use client';

export function LogoutButton() {
  function logout() {
    document.cookie = 'pension_jwt=; path=/; max-age=0; samesite=lax';
    window.location.href = '/login';
  }
  return (
    <button onClick={logout} className="btn-ghost btn-sm">
      התנתק
    </button>
  );
}
