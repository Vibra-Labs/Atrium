export default function DashboardLoading() {
  // Pages render their own skeletons; this only holds the space until they mount.
  return <div className="min-h-[50vh]" aria-busy="true" />;
}
