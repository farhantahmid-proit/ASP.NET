export type WorkspaceRegistrationRequest = {
  workspace: {
    name: string
    email: string
  }
  administrator: {
    name: string
    password: string
  }
}

export type WorkspaceLoginRequest = {
  email: string
  password: string
}
