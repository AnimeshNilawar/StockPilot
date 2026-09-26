/**
 * Data-access hooks.
 *
 * One place that knows how the API responds, so screens never hand-roll query
 * keys or cache invalidation:
 *
 *   - list responses are `{ data: { items, pagination } }`, options endpoints
 *     are `{ data: [...] }`;
 *   - every mutation invalidates the affected key families rather than the whole
 *     cache, so typing in a search box does not refetch unrelated screens.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api as http } from '../lib/api';

/** Drops empty values so they never reach the query string as `?search=`. */
export const cleanParams = (params = {}) =>
  Object.fromEntries(
    Object.entries(params).filter(
      ([, value]) => value !== '' && value !== null && value !== undefined,
    ),
  );

export const toQueryString = (params = {}) => {
  const search = new URLSearchParams();
  Object.entries(cleanParams(params)).forEach(([key, value]) => {
    if (Array.isArray(value)) {
      if (value.length > 0) search.set(key, value.join(','));
    } else {
      search.set(key, String(value));
    }
  });
  const query = search.toString();
  return query ? `?${query}` : '';
};

const fetcher = (path, params) => async () => {
  const response = await http.get(`${path}${toQueryString(params)}`);
  return response.data;
};

/**
 * Paginated list query.
 *
 * `keepPreviousData` keeps the table on screen while the next page loads, so the
 * layout does not jump between pages.
 */
export function useListQuery(key, path, params, options = {}) {
  return useQuery({
    queryKey: [...key, cleanParams(params)],
    queryFn: fetcher(path, params),
    placeholderData: (previous) => previous,
    staleTime: 30_000,
    ...options,
  });
}

export function useOptionsQuery(key, path, options = {}) {
  return useQuery({
    queryKey: key,
    queryFn: async () => (await http.get(path)).data,
    staleTime: 5 * 60_000,
    ...options,
  });
}

export function useDetailQuery(key, path, options = {}) {
  return useQuery({
    queryKey: [...key],
    queryFn: async () => (await http.get(path)).data,
    ...options,
  });
}

/**
 * Mutation with a consistent success/failure path: toast on both outcomes and
 * invalidate the named key families on success.
 */
export function useApiMutation({ mutationFn, invalidates = [], onSuccess, onError }) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn,
    onSuccess: async (data, variables) => {
      invalidates.forEach((key) => queryClient.invalidateQueries({ queryKey: key }));
      if (onSuccess) await onSuccess(data, variables);
    },
    onError,
  });
}

/** Wipes every cached list so dependent screens refetch (used after deletes). */
export const useInvalidate = () => {
  const queryClient = useQueryClient();
  return (...keys) => keys.forEach((key) => queryClient.invalidateQueries({ queryKey: key }));
};

export const catalogKeys = {
  products: ['products'],
  product: (id) => ['products', 'detail', id],
  categories: ['categories'],
  categoryTree: ['categories', 'tree'],
  uoms: ['uoms'],
  warehouses: ['warehouses'],
  locations: ['locations'],
  locationsFor: (warehouseId) => ['locations', 'by-warehouse', warehouseId],
  stock: ['stock'],
  moves: ['moves'],
};

export const api = {
  products: {
    list: (params) => http.get(`/products${toQueryString(params)}`),
    get: (id) => http.get(`/products/${id}`),
    create: (body) => http.post('/products', body),
    update: (id, body) => http.patch(`/products/${id}`, body),
    remove: (id) => http.delete(`/products/${id}`),
  },
  categories: {
    list: (params) => http.get(`/categories${toQueryString(params)}`),
    tree: () => http.get('/categories/tree'),
    create: (body) => http.post('/categories', body),
    update: (id, body) => http.patch(`/categories/${id}`, body),
    remove: (id) => http.delete(`/categories/${id}`),
  },
  uoms: {
    list: (params) => http.get(`/uoms${toQueryString(params)}`),
    options: () => http.get('/uoms/options'),
    create: (body) => http.post('/uoms', body),
    update: (id, body) => http.patch(`/uoms/${id}`, body),
    remove: (id) => http.delete(`/uoms/${id}`),
  },
  warehouses: {
    list: (params) => http.get(`/warehouses${toQueryString(params)}`),
    options: () => http.get('/warehouses/options'),
    get: (id) => http.get(`/warehouses/${id}`),
    create: (body) => http.post('/warehouses', body),
    update: (id, body) => http.patch(`/warehouses/${id}`, body),
    remove: (id) => http.delete(`/warehouses/${id}`),
  },
  locations: {
    list: (params) => http.get(`/locations${toQueryString(params)}`),
    forWarehouse: (warehouseId, params) =>
      http.get(`/warehouses/${warehouseId}/locations${toQueryString(params)}`),
    options: () => http.get('/locations/options'),
    create: (body) => http.post('/locations', body),
    update: (id, body) => http.patch(`/locations/${id}`, body),
    remove: (id) => http.delete(`/locations/${id}`),
  },
  stock: {
    list: (params) => http.get(`/stock${toQueryString(params)}`),
    lowStock: (params) => http.get(`/stock/low-stock${toQueryString(params)}`),
  },
  moves: {
    list: (params) => http.get(`/moves${toQueryString(params)}`),
    get: (id) => http.get(`/moves/${id}`),
  },
};
