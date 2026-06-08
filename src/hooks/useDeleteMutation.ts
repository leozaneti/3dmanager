import { useMutation, useQueryClient, type QueryKey } from "@tanstack/react-query";
import { api } from "../ui/api";

type UseDeleteMutationOptions = {
  endpoint: string;
  queryKeysToInvalidate: QueryKey[];
  onSuccess?: () => void;
  onError?: (err: Error) => void;
};

export function useDeleteMutation(options: UseDeleteMutationOptions) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => api(`${options.endpoint}/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      options.queryKeysToInvalidate.forEach((key) => {
        queryClient.invalidateQueries({ queryKey: key });
      });
      options.onSuccess?.();
    },
    onError: options.onError,
  });
}
