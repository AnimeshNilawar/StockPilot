import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api, setAccessToken } from '../lib/api';

export function useAuth() {
  const queryClient = useQueryClient();

  const { data, isLoading, error } = useQuery({
    queryKey: ['auth', 'me'],
    queryFn: () => api.get('/auth/me'),
    retry: false,
    staleTime: Infinity,
  });

  const loginMutation = useMutation({
    mutationFn: (credentials) => api.post('/auth/login', credentials),
    onSuccess: (res) => {
      setAccessToken(res.data.accessToken);
      queryClient.setQueryData(['auth', 'me'], { data: res.data.user });
    },
  });

  const logoutMutation = useMutation({
    mutationFn: () => api.post('/auth/logout'),
    onSettled: () => {
      setAccessToken(null);
      queryClient.setQueryData(['auth', 'me'], null);
      queryClient.clear();
    },
  });

  return {
    user: data?.data || null,
    isLoading,
    error,
    login: loginMutation.mutateAsync,
    logout: logoutMutation.mutateAsync,
    isAuthenticated: !!data?.data,
  };
}
