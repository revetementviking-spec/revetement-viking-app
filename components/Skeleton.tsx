export function SkeletonCard() {
  return (
    <div className="bg-white rounded-lg shadow p-4 space-y-2">
      <div className="skeleton h-5 w-3/4" />
      <div className="skeleton h-3 w-1/2" />
      <div className="skeleton h-2 w-full mt-2" />
      <div className="grid grid-cols-2 gap-2 pt-2">
        <div className="skeleton h-3 w-full" />
        <div className="skeleton h-3 w-full" />
      </div>
    </div>
  );
}

export function SkeletonKPI() {
  return (
    <div className="bg-white rounded-lg shadow p-4">
      <div className="skeleton h-3 w-2/3 mb-2" />
      <div className="skeleton h-7 w-1/2" />
    </div>
  );
}

export function SkeletonGrid({ n = 3 }: { n?: number }) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
      {Array.from({ length: n }).map((_, i) => <SkeletonCard key={i} />)}
    </div>
  );
}

export function SkeletonRow() {
  return (
    <div className="flex items-center gap-3 p-3 border-b">
      <div className="skeleton w-10 h-10 rounded-full" />
      <div className="flex-1 space-y-1">
        <div className="skeleton h-4 w-2/3" />
        <div className="skeleton h-3 w-1/3" />
      </div>
      <div className="skeleton h-5 w-16" />
    </div>
  );
}
