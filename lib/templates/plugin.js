import Vue from 'vue'
import VueApollo from 'vue-apollo'
import 'isomorphic-fetch'
import jsCookie from 'js-cookie'
import cookie from 'cookie'
import { InMemoryCache } from 'apollo-cache-inmemory'

import { createHttpLink } from 'apollo-link-http'
import { SubscriptionClient } from 'subscriptions-transport-ws'
import MessageTypes from 'subscriptions-transport-ws/dist/message-types'
import { WebSocketLink } from 'apollo-link-ws'
import { getMainDefinition } from 'apollo-utilities'
import { createPersistedQueryLink } from 'apollo-link-persisted-queries'
import { setContext } from 'apollo-link-context'
import { withClientState } from 'apollo-link-state'

// Create the apollo client
export function createApolloClient ({
  httpEndpoint,
  httpLinkOptions = {},
  wsEndpoint = null,
  uploadEndpoint = null,
  tokenName = 'apollo-token',
  persisting = false,
  ssr = false,
  websocketsOnly = false,
  link = null,
  cache = null,
  apollo = {},
  clientState = null,
  getAuth = defaultGetAuth,
}) {
  let wsClient, authLink, stateLink
  const disableHttp = websocketsOnly && !ssr && wsEndpoint

  // Apollo cache
  if (!cache) {
    cache = new InMemoryCache()
  }

  if (!disableHttp) {
    const httpLink = createHttpLink({
      uri: httpEndpoint,
      ...httpLinkOptions,
    })

    if (!link) {
      link = httpLink
    } else {
      link = from([link, httpLink])
    }

    // HTTP Auth header injection
    authLink = setContext((_, { headers }) => {
      const authorization = getAuth(tokenName)
      const authorizationHeader = authorization ? { authorization } : {}
      return {
        headers: {
          ...headers,
          ...authorizationHeader,
        },
      }
    })

    // Concat all the http link parts
    link = authLink.concat(link)
  }

  // On the server, we don't want WebSockets and Upload links
  if (!ssr) {
    // If on the client, recover the injected state
    if (typeof window !== 'undefined') {
      // eslint-disable-next-line no-underscore-dangle
      const state = window.__APOLLO_STATE__
      if (state) {
        // If you have multiple clients, use `state.<client_id>`
        cache.restore(state.defaultClient)
      }
    }

    if (!disableHttp) {
      if (persisting) {
        link = createPersistedQueryLink().concat(link)
      }
    }

    // Web socket
    if (wsEndpoint) {
      wsClient = new SubscriptionClient(wsEndpoint, {
        reconnect: true,
        connectionParams: () => {
          const authorization = getAuth(tokenName)
          return authorization ? { authorization } : {}
        },
      })

      // Create the subscription websocket link
      const wsLink = new WebSocketLink(wsClient)

      if (disableHttp) {
        link = wsLink
      } else {
        link = split(
          // split based on operation type
          ({ query }) => {
            const { kind, operation } = getMainDefinition(query)
            return kind === 'OperationDefinition' &&
              operation === 'subscription'
          },
          wsLink,
          link
        )
      }
    }
  }

  if (clientState) {
    stateLink = withClientState({
      cache,
      ...clientState,
    })
    link = from([stateLink, link])
  }

  const apolloClient = new ApolloClient({
    link,
    cache,
    // Additional options
    ...(ssr ? {
      // Set this on the server to optimize queries when SSR
      ssrMode: true,
    } : {
      // This will temporary disable query force-fetching
      ssrForceFetchDelay: 100,
      // Apollo devtools
      connectToDevTools: process.env.NODE_ENV !== 'production',
    }),
    ...apollo,
  })

  // Re-write the client state defaults on cache reset
  if (stateLink) {
    apolloClient.onResetStore(stateLink.writeDefaults)
  }

  return {
    apolloClient,
    wsClient,
    stateLink,
  }
}

export function restartWebsockets (wsClient) {
  // Copy current operations
  const operations = Object.assign({}, wsClient.operations)

  // Close connection
  wsClient.close(true)

  // Open a new one
  wsClient.connect()

  // Push all current operations to the new connection
  Object.keys(operations).forEach(id => {
    wsClient.sendMessage(
      id,
      MessageTypes.GQL_START,
      operations[id].options
    )
  })
}

function defaultGetAuth (tokenName) {
  if (typeof window !== 'undefined') {
    // get the authentication token from local storage if it exists
    const token = window.localStorage.getItem(tokenName)
    // return the headers to the context so httpLink can read them
    return token ? `Bearer ${token}` : ''
  }
}

Vue.use(VueApollo)

export default (ctx, inject) => {
  const providerOptions = { clients: {} }
  const { app, beforeNuxtRender, req } = ctx
  const AUTH_TOKEN_NAME = '<%= options.tokenName %>'
  const AUTH_TOKEN_EXPIRES = <%= options.tokenExpires %>
  const AUTH_TYPE = '<%= options.authenticationType %> '

  // Config
  <% Object.keys(options.clientConfigs).forEach((key) => { %>
      const <%= key %>TokenName = '<%= options.clientConfigs[key].tokenName %>'  || AUTH_TOKEN_NAME

      function <%= key %>GetAuth () {
        let token
        if(process.server){
          const cookies = cookie.parse((req && req.headers.cookie) || '')
          token = cookies[<%= key %>TokenName]
        } else {
          token = jsCookie.get(<%= key %>TokenName)
        }
        return token ? AUTH_TYPE + token : ''
      }

      let <%= key %>ClientConfig;
      <% if (typeof options.clientConfigs[key] === 'object') { %>
        <%= key %>ClientConfig = <%= JSON.stringify(options.clientConfigs[key], null, 2) %>
      <% } else if (typeof options.clientConfigs[key] === 'string') { %>
        <%= key %>ClientConfig = require('<%= options.clientConfigs[key] %>')

        if ('default' in <%= key %>ClientConfig) {
          <%= key %>ClientConfig = <%= key %>ClientConfig.default
        }

        <%= key %>ClientConfig = <%= key %>ClientConfig(ctx)
      <% } %>

      const <%= key %>Cache = <%= key %>ClientConfig.cache
        ? <%= key %>ClientConfig.cache
        : new InMemoryCache()

      if (!process.server) {
        <%= key %>Cache.restore(window.__NUXT__ ? window.__NUXT__.apollo.<%= key === 'default' ? 'defaultClient' : key %> : null)
      }

      if (!<%= key %>ClientConfig.getAuth) {
        <%= key %>ClientConfig.getAuth = <%= key %>GetAuth
      }
      <%= key %>ClientConfig.ssr = !!process.server
      <%= key %>ClientConfig.cache = <%= key %>Cache
      <%= key %>ClientConfig.tokenName = <%= key %>TokenName

      // Create apollo client
      let <%= key %>ApolloCreation = createApolloClient({
        ...<%= key %>ClientConfig
      })
      <%= key %>ApolloCreation.apolloClient.wsClient = <%= key %>ApolloCreation.wsClient

      <% if (key === 'default') { %>
          providerOptions.<%= key %>Client = <%= key %>ApolloCreation.apolloClient
      <% } else { %>
          providerOptions.clients.<%= key %> = <%= key %>ApolloCreation.apolloClient
      <% } %>
  <% }) %>

  const vueApolloOptions = Object.assign(providerOptions, {
      <% if (options.errorHandler) { %>
        <%= options.errorHandler %>
      <% } else { %>
        errorHandler (error) {
          console.log('%cError', 'background: red; color: white; padding: 2px 4px; border-radius: 3px; font-weight: bold;', error.message)
        }
      <% } %>
  })

  const apolloProvider = new VueApollo(vueApolloOptions)
  // Allow access to the provider in the context
  app.apolloProvider = apolloProvider
  // Install the provider into the app
  app.provide = apolloProvider.provide()

  if (process.server) {
    beforeNuxtRender(async ({ Components, nuxtState }) => {
      Components.forEach((Component) => {
        // Fix https://github.com/nuxt-community/apollo-module/issues/19
        if (Component.options && Component.options.apollo && Component.options.apollo.$init) {
          delete Component.options.apollo.$init
        }
      })
      await apolloProvider.prefetchAll(ctx, Components)
      nuxtState.apollo = apolloProvider.getStates()
    })
  }

  inject('apolloHelpers', {
    onLogin: async (token, apolloClient = apolloProvider.defaultClient, tokenExpires = AUTH_TOKEN_EXPIRES) => {
      if (token) {
        jsCookie.set(AUTH_TOKEN_NAME, token, { expires: tokenExpires })
      } else {
        jsCookie.remove(AUTH_TOKEN_NAME)
      }
      if (apolloClient.wsClient) restartWebsockets(apolloClient.wsClient)
      try {
        await apolloClient.resetStore()
      } catch (e) {
        // eslint-disable-next-line no-console
        console.log('%cError on cache reset (setToken)', 'color: orange;', e.message)
      }
    },
    onLogout: async (apolloClient = apolloProvider.defaultClient) => {
        jsCookie.remove(AUTH_TOKEN_NAME)
        if (apolloClient.wsClient) restartWebsockets(apolloClient.wsClient)
        try {
            await apolloClient.resetStore()
        } catch (e) {
            // eslint-disable-next-line no-console
            console.log('%cError on cache reset (logout)', 'color: orange;', e.message)
        }
    },
    getToken: (tokenName = AUTH_TOKEN_NAME) => {
        if(process.server){
            const cookies = cookie.parse((req && req.headers.cookie) || '')
            return cookies && cookies[tokenName]
        }
        return jsCookie.get(tokenName)
    }
  })
}
