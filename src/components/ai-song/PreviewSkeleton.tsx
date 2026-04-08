import React from 'react';

export function PreviewSkeleton() {
  return (
    <div className="space-y-4 animate-pulse">
      {/* Song Info Skeleton */}
      <div className="p-4 bg-gray-900/50 rounded-lg space-y-3">
        <div className="h-4 bg-gray-800 rounded w-1/3"></div>
        <div className="grid grid-cols-3 gap-4">
          <div className="space-y-2">
            <div className="h-3 bg-gray-800 rounded w-16"></div>
            <div className="h-4 bg-gray-700 rounded w-20"></div>
          </div>
          <div className="space-y-2">
            <div className="h-3 bg-gray-800 rounded w-20"></div>
            <div className="h-4 bg-gray-700 rounded w-16"></div>
          </div>
          <div className="space-y-2">
            <div className="h-3 bg-gray-800 rounded w-16"></div>
            <div className="h-4 bg-gray-700 rounded w-20"></div>
          </div>
        </div>
      </div>

      {/* Pattern Grid Skeleton */}
      <div className="p-4 bg-gray-900/50 rounded-lg space-y-3">
        <div className="h-4 bg-gray-800 rounded w-1/4"></div>
        <div className="space-y-1">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="flex items-center gap-1">
              <div className="w-20 h-3 bg-gray-800 rounded mr-2"></div>
              <div className="flex gap-0.5">
                {Array.from({ length: 32 }).map((_, j) => (
                  <div key={j} className="w-2 h-4 bg-gray-800 rounded-sm"></div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Stats Skeleton */}
      <div className="p-4 bg-gray-900/50 rounded-lg space-y-3">
        <div className="h-4 bg-gray-800 rounded w-1/4"></div>
        <div className="space-y-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="flex items-center gap-2">
              <div className="w-20 h-3 bg-gray-800 rounded"></div>
              <div className="flex-1 h-2 bg-gray-800 rounded-full"></div>
              <div className="w-8 h-3 bg-gray-800 rounded"></div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
