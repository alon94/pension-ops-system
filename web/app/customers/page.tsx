import { CustomerSearch } from '../../components/CustomerSearch';

export default function CustomersPage() {
  return (
    <div className="space-y-6 max-w-2xl animate-fade-in">
      <div>
        <h1 className="page-title">לקוחות</h1>
        <p className="muted text-sm mt-1">חפש לקוח לפי שם, ת.ז. או חלק מהם.</p>
      </div>
      <CustomerSearch />
    </div>
  );
}
