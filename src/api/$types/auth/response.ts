export type WorkspaceRegistrationResponse = {
  workspace: {
    id: string
    name: string
    slug: string
  }
  administrator: {
    id: string
    workspace_id: string
    name: string
    email: string
    role: string
  }
  widget: {
    id: string
    workspace_id: string
    public_key: string
    name: string
    is_default: boolean
  }
}

export type WorkspaceAuthResponse = {
  access_token: string
  refresh_token: string
  token_type: string
  expires_in: number
  refresh_expires_in: number
  workspace: WorkspaceRegistrationResponse['workspace']
  administrator: WorkspaceRegistrationResponse['administrator']
  widget: WorkspaceRegistrationResponse['widget']
}
